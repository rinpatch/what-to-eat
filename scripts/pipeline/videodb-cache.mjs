import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { repoRoot } from "./config.mjs";
import { paths, readPipelineDb, writeJson, readJson } from "./fsdb.mjs";
import { sleep } from "./http.mjs";

export const COMPLETE = "complete";
export const PARTIAL = "partial";
export const FAILED = "failed";
export const REQUIRED_POST_FIELDS = [
  "post_id",
  "video_url",
  "caption",
  "creator_handle",
  "posted_at",
  "engagement",
  "source_url",
];

export function resolveRepoPath(value, fallback) {
  const chosen = value || fallback;
  return isAbsolute(chosen) ? chosen : join(repoRoot, chosen);
}

export async function loadInputPosts(inputPath = "") {
  if (inputPath) {
    const data = JSON.parse(await readFile(resolveRepoPath(inputPath), "utf8"));
    if (!Array.isArray(data)) throw new Error("Input posts must be a JSON array");
    return data.filter((row) => row && typeof row === "object");
  }

  const db = await readPipelineDb();
  return reelsToSeedPosts(db.reels || []);
}

export function reelsToSeedPosts(reels) {
  return reels
    .filter((reel) => reel?.mediaUrl || reel?.url)
    .map((reel) => ({
      post_id: reel.id,
      video_url: reel.mediaUrl || reel.url,
      caption: reel.caption || "",
      creator_handle: normalizeHandle(reel.creatorUsername || reel.creatorUrl || ""),
      posted_at: reel.publishedAt || null,
      engagement: reel.metrics || {},
      source_url: reel.url || reel.mediaUrl || "",
    }));
}

export async function buildVideoDbCache(options) {
  const posts = await loadInputPosts(options.input || "");
  return buildVideoDbCacheFromPosts(posts, options);
}

export async function buildVideoDbCacheFromPosts(posts, options) {
  const {
    adapter,
    demo = false,
    output = paths.videoDbEvidence,
    limit = null,
    retryFailed = false,
    skipComplete = true,
    searchAttempts = demo ? 1 : 3,
    searchDelayMs = demo ? 0 : 5000,
  } = options;

  const selectedPosts = Number.isFinite(limit) ? posts.slice(0, limit) : posts;
  const outputPath = resolveRepoPath(output, paths.videoDbEvidence);
  const existingRows = await readJson(outputPath, []);
  const byPostId = new Map(existingRows.filter(Boolean).map((row) => [String(row.post_id), stableEvidenceRow(row)]));
  const order = existingRows.map((row) => String(row?.post_id || "")).filter(Boolean);

  for (const post of selectedPosts) {
    const postId = postIdFor(post);
    const existing = byPostId.get(postId);
    if (shouldSkip(existing, { retryFailed, skipComplete })) continue;

    const row = await processPost(post, { adapter, demo, searchAttempts, searchDelayMs });
    byPostId.set(postId, row);
    if (!order.includes(postId)) order.push(postId);
    await writeJson(outputPath, order.map((id) => byPostId.get(id)).filter(Boolean));
  }

  const rows = order.map((id) => byPostId.get(id)).filter(Boolean);
  await writeJson(outputPath, rows);
  return rows;
}

export async function processPost(post, options = {}) {
  const { adapter, demo = false, searchAttempts = 3, searchDelayMs = 5000 } = options;
  const validationErrors = validatePost(post);
  if (validationErrors.length) return emptyEvidence(post, FAILED, validationErrors);
  if (demo) return demoEvidence(post);
  if (!adapter) return emptyEvidence(post, FAILED, ["VideoDB adapter is required unless --demo is used"]);

  let asset;
  try {
    asset = await adapter.uploadVideo(post.video_url, { name: assetName(post) });
  } catch (error) {
    return emptyEvidence(post, FAILED, [`upload failed: ${error.message}`]);
  }

  const errors = [];
  try {
    await adapter.indexFoodAudio(asset.id);
  } catch (error) {
    errors.push(`audio index failed: ${error.message}`);
  }

  try {
    await adapter.indexFoodVisuals(asset.id);
  } catch (error) {
    errors.push(`visual index failed: ${error.message}`);
  }

  let moments = { transcriptSnippets: [], visualSnippets: [] };
  try {
    moments = await searchWithRetry(adapter, asset.id, { searchAttempts, searchDelayMs });
  } catch (error) {
    errors.push(`search failed: ${error.message}`);
  }

  const transcriptSnippets = normalizeSnippetList(moments.transcriptSnippets || moments.transcript_snippets || []);
  const visualSnippets = normalizeSnippetList(moments.visualSnippets || moments.visual_snippets || []);
  const bestClip = selectBestClip(transcriptSnippets, visualSnippets);
  if (!bestClip) errors.push("no searchable transcript or visual snippets returned");

  return evidenceRow({
    post,
    videoId: asset.id,
    streamUrl: asset.streamUrl || asset.stream_url || null,
    bestClip,
    transcriptSnippets,
    visualSnippets,
    processingStatus: bestClip ? (errors.length ? PARTIAL : COMPLETE) : FAILED,
    errors,
  });
}

export async function searchWithRetry(adapter, videoId, options = {}) {
  const attempts = Math.max(1, Number(options.searchAttempts || 1));
  const delayMs = Math.max(0, Number(options.searchDelayMs || 0));
  let lastMoments = { transcriptSnippets: [], visualSnippets: [] };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastMoments = await adapter.searchFoodMoments(videoId);
    const transcript = lastMoments.transcriptSnippets || lastMoments.transcript_snippets || [];
    const visual = lastMoments.visualSnippets || lastMoments.visual_snippets || [];
    if (transcript.length || visual.length || attempt === attempts) return lastMoments;
    if (delayMs > 0) await sleep(delayMs);
  }

  return lastMoments;
}

export function shouldSkip(existing, options = {}) {
  if (!existing) return false;
  if (existing.processing_status === COMPLETE && options.skipComplete !== false) return true;
  if ([FAILED, PARTIAL].includes(existing.processing_status) && !options.retryFailed) return true;
  return false;
}

export function validatePost(post) {
  const errors = [];
  for (const field of REQUIRED_POST_FIELDS) {
    if (!(field in post)) errors.push(`missing required field: ${field}`);
  }
  if ("video_url" in post && !String(post.video_url || "").trim()) errors.push("video_url must be non-empty");
  if ("engagement" in post && (typeof post.engagement !== "object" || Array.isArray(post.engagement) || post.engagement === null)) {
    errors.push("engagement must be an object");
  }
  return errors;
}

export function evidenceRow({
  post,
  videoId,
  streamUrl,
  bestClip,
  transcriptSnippets,
  visualSnippets,
  processingStatus,
  errors,
}) {
  const spokenText = transcriptSnippets.map((snippet) => snippet.text).filter(Boolean).join(" ");
  const onscreenText = visualSnippets.map((snippet) => snippet.text).filter(Boolean).join(" ");
  return stableEvidenceRow({
    post_id: postIdFor(post),
    video_id: videoId || null,
    video_url: post.video_url || null,
    stream_url: streamUrl || null,
    processing_status: processingStatus,
    best_clip: bestClip || null,
    transcript_snippets: transcriptSnippets,
    visual_snippets: visualSnippets,
    quote_candidates: quoteCandidates(transcriptSnippets),
    tokenrouter_input: {
      caption: post.caption || "",
      creator_handle: post.creator_handle || "",
      clip_start: bestClip?.start ?? null,
      clip_end: bestClip?.end ?? null,
      spoken_text: spokenText,
      onscreen_text: onscreenText,
    },
    errors,
  });
}

export function emptyEvidence(post, processingStatus, errors) {
  return evidenceRow({
    post,
    videoId: null,
    streamUrl: null,
    bestClip: null,
    transcriptSnippets: [],
    visualSnippets: [],
    processingStatus,
    errors,
  });
}

export function demoEvidence(post) {
  const transcriptSnippets = [
    normalizeSnippet({
      start: 6,
      end: 14,
      text: post.caption || "Demo transcript placeholder from cached food video evidence.",
      score: 0.88,
      source: "spoken_word",
    }),
  ];
  const visualSnippets = [
    normalizeSnippet({
      start: 9,
      end: 18,
      text: "Food close-up, dish reveal, menu or storefront context visible.",
      score: 0.86,
      source: "scene",
    }),
  ];
  return evidenceRow({
    post,
    videoId: stableId(post.video_url || postIdFor(post), "demo-vdb"),
    streamUrl: null,
    bestClip: selectBestClip(transcriptSnippets, visualSnippets),
    transcriptSnippets,
    visualSnippets,
    processingStatus: COMPLETE,
    errors: [],
  });
}

export function selectBestClip(transcriptSnippets, visualSnippets) {
  const overlap = bestOverlap(transcriptSnippets, visualSnippets);
  if (overlap) return overlap;

  const visual = bestSingle(visualSnippets);
  if (visual) {
    return { start: visual.start, end: clipEnd(visual.start, visual.end), reason: "visual food evidence" };
  }

  const transcript = bestSingle(transcriptSnippets);
  if (transcript) {
    return { start: transcript.start, end: clipEnd(transcript.start, transcript.end), reason: "spoken creator reaction" };
  }

  return null;
}

export function normalizeSnippetList(snippets) {
  return snippets.map(normalizeSnippet).filter((snippet) => snippet.text || snippet.end > snippet.start);
}

export function normalizeSnippet(snippet) {
  const start = numberOrZero(snippet.start ?? snippet.start_time ?? snippet.startTime);
  const rawEnd = numberOrZero(snippet.end ?? snippet.end_time ?? snippet.endTime);
  const end = Math.max(start, rawEnd);
  return {
    start: round2(start),
    end: round2(end),
    text: String(snippet.text || snippet.description || snippet.caption || "").trim(),
    score: optionalNumber(snippet.score ?? snippet.search_score ?? snippet.searchScore),
    source: String(snippet.source || snippet.index_type || snippet.indexType || "unknown"),
  };
}

export function quoteCandidates(transcriptSnippets) {
  const keywords = ["worth", "must", "try", "best", "cheap", "spicy", "crispy", "queue", "love", "shiok"];
  const candidates = [];
  for (const snippet of transcriptSnippets) {
    const text = String(snippet.text || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 180) continue;
    if (keywords.some((keyword) => text.toLowerCase().includes(keyword))) candidates.push(text);
  }
  return candidates.slice(0, 3);
}

export async function readPublicVideoEvidence(path = paths.videoDbEvidence) {
  const rows = await readJson(resolveRepoPath(path, paths.videoDbEvidence), []);
  if (!Array.isArray(rows)) throw new Error("VideoDB evidence cache must be a JSON array");
  return rows
    .map(stableEvidenceRow)
    .filter((row) => [COMPLETE, PARTIAL].includes(row.processing_status));
}

export function stableEvidenceRow(row) {
  return {
    post_id: row.post_id || null,
    video_id: row.video_id || null,
    video_url: row.video_url || null,
    stream_url: row.stream_url || null,
    processing_status: row.processing_status || PARTIAL,
    best_clip: row.best_clip || null,
    transcript_snippets: Array.isArray(row.transcript_snippets) ? row.transcript_snippets : [],
    visual_snippets: Array.isArray(row.visual_snippets) ? row.visual_snippets : [],
    quote_candidates: Array.isArray(row.quote_candidates) ? row.quote_candidates : [],
    tokenrouter_input: row.tokenrouter_input && typeof row.tokenrouter_input === "object" ? row.tokenrouter_input : {},
    errors: Array.isArray(row.errors) ? row.errors : [],
  };
}

function bestOverlap(transcriptSnippets, visualSnippets) {
  const candidates = [];
  for (const spoken of transcriptSnippets) {
    for (const scene of visualSnippets) {
      const overlapStart = Math.max(spoken.start, scene.start);
      const overlapEnd = Math.min(spoken.end, scene.end);
      if (overlapEnd <= overlapStart) continue;
      const start = Math.max(0, Math.min(spoken.start, scene.start));
      const end = clipEnd(start, Math.max(spoken.end, scene.end));
      const score = (optionalNumber(spoken.score) || 0) + (optionalNumber(scene.score) || 0);
      candidates.push({ score, clip: { start, end, reason: "overlapping spoken and visual food evidence" } });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.clip || null;
}

function bestSingle(snippets) {
  return [...snippets].sort((a, b) => (optionalNumber(b.score) || 0) - (optionalNumber(a.score) || 0))[0] || null;
}

function clipEnd(start, rawEnd) {
  const duration = Math.max(6, Math.min(18, rawEnd - start));
  return round2(start + duration);
}

function postIdFor(post) {
  return String(post.post_id || stableId(post.video_url || post.source_url || JSON.stringify(post), "post"));
}

function assetName(post) {
  return [post.creator_handle, postIdFor(post)].filter(Boolean).join(" ");
}

function normalizeHandle(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("@")) return text;
  try {
    const parsed = new URL(text);
    return normalizeHandle(parsed.pathname.split("/").filter(Boolean).at(-1) || text);
  } catch {
    return `@${text.replace(/^@/, "")}`;
  }
}

function stableId(value, prefix = "id") {
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${prefix}-${hash.toString(16)}`;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
