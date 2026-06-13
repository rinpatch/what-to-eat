import { pipelineConfig, requireEnv } from "./config.mjs";

export const FOOD_AUDIO_PROMPT =
  "Extract Singapore food creator speech: dish names, venue names, prices, queue or worth-it reactions, texture comments, and short quotable reactions.";

export const FOOD_VISUAL_PROMPT =
  "Describe Singapore food video visuals: dish reveal, food close-ups, menu text, price boards, storefront signs, maps, and creator eating reactions.";

const FOOD_REACTION_QUERY =
  "creator reaction worth it must try queue spicy crispy cheap food review";
const FOOD_VISUAL_QUERY =
  "dish reveal close-up food shot eating reaction menu price storefront restaurant name";
const FOOD_PLACE_QUERY = "restaurant name storefront menu price location sign";

export async function createVideoDbAdapter(options = {}) {
  const apiKey = options.apiKey || requireEnv("VIDEODB_API_KEY");
  const config = pipelineConfig();
  const collectionId = options.collectionId || config.videoDb.collectionId || "default";
  const operationTimeoutMs = Number(
    options.operationTimeoutMs || process.env.VIDEODB_OPERATION_TIMEOUT_MS || 120000,
  );
  let connect;
  try {
    ({ connect } = await import("videodb"));
  } catch {
    throw new Error("Missing VideoDB Node SDK. Run `npm install` or `npm install videodb` before live cache builds.");
  }
  const conn = connect.length === 0 ? connect() : connect({ apiKey });
  const videos = new Map();

  return {
    async uploadVideo(url, { name = "" } = {}) {
      const video = await withTimeout(uploadUrl(conn, collectionId, url), operationTimeoutMs, "VideoDB upload");
      await withTimeout(updateName(video, name), operationTimeoutMs, "VideoDB metadata update");
      const streamUrl = await withTimeout(generateStream(video), operationTimeoutMs, "VideoDB stream generation");
      const id = String(video.id || video.videoId || video._id || stableId(url));
      videos.set(id, video);
      return { id, name: name || id, url, streamUrl };
    },

    async indexFoodAudio(videoId) {
      const video = requireVideo(videos, videoId);
      await withTimeout(
        callFirstAvailable(video, ["indexSpokenWords", "indexAudio", "index_spoken_words", "index_audio"], [
          [],
        ]),
        operationTimeoutMs,
        "VideoDB audio index",
      );
    },

    async indexFoodVisuals(videoId) {
      const video = requireVideo(videos, videoId);
      await withTimeout(
        callFirstAvailable(video, ["indexVisuals", "index_visuals", "indexScenes", "index_scenes"], [
          [{ prompt: FOOD_VISUAL_PROMPT }],
          [FOOD_VISUAL_PROMPT],
          [],
        ]),
        operationTimeoutMs,
        "VideoDB visual index",
      );
    },

    async searchFoodMoments(videoId) {
      const video = requireVideo(videos, videoId);
      const transcript = await withTimeout(
        searchVideo(video, FOOD_REACTION_QUERY, "spoken_word"),
        operationTimeoutMs,
        "VideoDB transcript search",
      );
      const visual = [
        ...(await withTimeout(searchVideo(video, FOOD_VISUAL_QUERY, "scene"), operationTimeoutMs, "VideoDB visual search")),
        ...(await withTimeout(searchVideo(video, FOOD_PLACE_QUERY, "scene"), operationTimeoutMs, "VideoDB place search")),
      ];
      return {
        transcriptSnippets: dedupeShots(transcript),
        visualSnippets: dedupeShots(visual),
      };
    },

    async getTranscript(videoId) {
      const video = requireVideo(videos, videoId);
      const transcript = await withTimeout(
        callFirstAvailable(video, ["getTranscript", "get_transcript"], [
          [],
        ]),
        operationTimeoutMs,
        "VideoDB transcript fetch",
      );
      return normalizeTranscript(transcript);
    },
  };
}

export function normalizeTranscript(transcript) {
  const rawSegments = Array.isArray(transcript)
    ? transcript
    : Array.isArray(transcript?.wordTimestamps)
      ? transcript.wordTimestamps
      : Array.isArray(transcript?.segments)
        ? transcript.segments
        : Array.isArray(transcript?.data)
          ? transcript.data
          : [];

  if (rawSegments.length) {
    return rawSegments
      .map((segment) => String(segment?.text || segment?.word || segment?.value || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return String(transcript?.text || transcript?.transcript || transcript || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadUrl(conn, collectionId, url) {
  if (typeof conn.uploadURL === "function") {
    return conn.uploadURL(collectionId, { url });
  }
  if (typeof conn.uploadUrl === "function") {
    return conn.uploadUrl(collectionId, { url });
  }
  if (typeof conn.getCollection === "function") {
    const collection = await conn.getCollection(collectionId);
    return collection.upload({ url });
  }
  if (typeof conn.get_collection === "function") {
    const collection = await conn.get_collection(collectionId);
    return collection.upload({ url });
  }
  throw new Error("VideoDB SDK does not expose an upload URL method");
}

async function updateName(video, name) {
  if (!name) return;
  if (typeof video.update === "function") {
    await callWithVariants(video.update.bind(video), [[{ name }], [name]]);
  }
}

async function generateStream(video) {
  if (typeof video.generateStream === "function") return video.generateStream();
  if (typeof video.generate_stream === "function") return video.generate_stream();
  return null;
}

async function searchVideo(video, query, indexType) {
  const results = await callWithVariants(video.search.bind(video), [
    [query, { indexType }],
    [query, { index_type: indexType }],
    [query, { search_type: "semantic" }],
    [query, indexType],
    [query],
  ]);
  return normalizeShots(results, indexType);
}

async function callFirstAvailable(target, names, argVariants) {
  for (const name of names) {
    if (typeof target[name] === "function") {
      return callWithVariants(target[name].bind(target), argVariants);
    }
  }
  return null;
}

async function callWithVariants(fn, argVariants) {
  let lastError = null;
  for (const args of argVariants) {
    try {
      return await fn(...args);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No compatible VideoDB SDK call signature worked");
}

function normalizeShots(results, fallbackSource) {
  const rawShots = Array.isArray(results)
    ? results
    : Array.isArray(results?.shots)
      ? results.shots
      : Array.isArray(results?.data?.shots)
        ? results.data.shots
        : [];
  return rawShots.map((shot) => ({
    start: numberOrZero(shot.start ?? shot.start_time ?? shot.startTime),
    end: numberOrZero(shot.end ?? shot.end_time ?? shot.endTime),
    text: String(shot.text || shot.description || shot.caption || "").trim(),
    score: optionalNumber(shot.score ?? shot.search_score ?? shot.searchScore),
    source: String(shot.source || shot.index_type || shot.indexType || fallbackSource),
    thumbnailUrl: shot.thumbnail_url || shot.thumbnailUrl || null,
    playbackUrl: shot.playback_url || shot.playbackUrl || null,
  }));
}

function dedupeShots(shots) {
  const seen = new Set();
  const result = [];
  for (const shot of shots) {
    const key = [Math.round(shot.start), Math.round(shot.end), shot.text.slice(0, 80)].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(shot);
  }
  return result;
}

function requireVideo(videos, videoId) {
  const video = videos.get(videoId);
  if (!video) throw new Error(`VideoDB asset not found in this run: ${videoId}`);
  return video;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableId(value) {
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `vdb-${hash.toString(16)}`;
}
