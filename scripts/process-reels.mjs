#!/usr/bin/env node
/**
 * Reads unprocessed raw_reels from Supabase, runs the full VideoDB pipeline,
 * extracts clip metadata via LLM, and writes results to the clips table.
 *
 * Usage:
 *   node scripts/process-reels.mjs [--limit=N] [--concurrency=N] [--write] [--overwrite] [--include-processed]
 */

import { createClient } from "@supabase/supabase-js";
import { loadDotEnv, pipelineConfig, requireEnv } from "./pipeline/config.mjs";
import { fetchJson } from "./pipeline/http.mjs";
import { createVideoDbAdapter, findQuoteStart } from "./pipeline/videodb.mjs";
import { processPost } from "./pipeline/videodb-cache.mjs";

// ── CLI args ──────────────────────────────────────────────────────────────────

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const limit = Number(argValue("limit") || 1);
const concurrency = Number(argValue("concurrency") || 5);
const write = hasFlag("write");
const overwrite = hasFlag("overwrite");
const includeProcessed = hasFlag("include-processed");
const skipVideodb = hasFlag("skip-videodb");
const searchAttempts = Number(argValue("search-attempts") || 2);
const searchDelayMs = Number(argValue("search-delay-ms") || 5000);

// ── Supabase ──────────────────────────────────────────────────────────────────

loadDotEnv();

let _db = null;
function db() {
  if (!_db) {
    const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    _db = createClient(url, key, { auth: { persistSession: false } });
  }
  return _db;
}

async function fetchUnprocessedReels(n, inclProcessed) {
  let query = db()
    .from("raw_reels")
    .select("reel_id, url, video_url, caption, transcript, likes, comments, shares, views, posted_at, place_id, creators(handle)")
    .not("video_url", "is", null)
    .order("posted_at", { ascending: false })
    .limit(n);

  if (!inclProcessed) query = query.eq("processed", false);

  const { data, error } = await query;
  if (error) throw new Error(`fetch raw_reels: ${error.message}`);
  return (data || []).map((row) => ({
    ...row,
    creator_handle: row.creators?.handle
      ? (row.creators.handle.startsWith("@") ? row.creators.handle : `@${row.creators.handle}`)
      : "",
  }));
}

async function clipExistsForReel(reelId) {
  const { count, error } = await db()
    .from("clips")
    .select("clip_id", { count: "exact", head: true })
    .eq("reel_id", reelId);
  if (error) throw new Error(`check clip existence: ${error.message}`);
  return (count ?? 0) > 0;
}

async function insertClip(clip) {
  const { error } = await db().from("clips").insert(clip);
  if (error) throw new Error(`insert clip: ${error.message}`);
}

async function markReelProcessed(reelId) {
  const { error } = await db()
    .from("raw_reels")
    .update({ processed: true, processing_error: null })
    .eq("reel_id", reelId);
  if (error) throw new Error(`mark processed: ${error.message}`);
}

async function saveReelError(reelId, message) {
  const { error } = await db()
    .from("raw_reels")
    .update({ processing_error: String(message).slice(0, 2000) })
    .eq("reel_id", reelId);
  if (error) console.error(`  [${reelId}] failed to save error: ${error.message}`);
}

async function saveTranscript(reelId, transcript) {
  const { error } = await db()
    .from("raw_reels")
    .update({ transcript })
    .eq("reel_id", reelId);
  if (error) throw new Error(`save transcript: ${error.message}`);
}

// ── LLM metadata extraction ───────────────────────────────────────────────────

const CUISINE_TAGS = ["chinese", "japanese", "korean", "local", "malay", "thai", "western"];
const PRICE_BAND_TAGS = ["cheap", "mid", "treat"];
const VIBE_TAGS = ["comfort", "date-night", "hawker", "spicy", "supper", "sweet"];

const FALLBACK_META = {
  dish_name: "Unknown dish",
  price: null,
  tags: { cuisine: "local", priceBand: "mid", vibe: "comfort" },
  pull_quote: null,
  sentiment: "neutral",
};

async function extractClipMeta(caption, transcript, quoteCandidates = []) {
  const config = pipelineConfig();
  const apiKey = config.tokenRouter.apiKey || config.kimi.apiKey;
  if (!apiKey) throw new Error("Missing TOKEN_ROUTER_API_KEY or KIMI_API_KEY");
  const baseUrl = config.tokenRouter.apiKey ? config.tokenRouter.baseUrl : config.kimi.baseUrl;
  const model = config.tokenRouter.apiKey ? config.tokenRouter.model : config.kimi.model;

  const context = [
    caption && `Caption: ${caption}`,
    transcript && `Transcript: ${transcript}`,
    quoteCandidates.length && `Quote candidates: ${quoteCandidates.join(" | ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!context.trim()) return FALLBACK_META;

  const response = await fetchJson(`${baseUrl}/chat/completions`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/rinpatch/what-to-eat-ah",
    },
    body: {
      model,
      temperature: 0,
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content:
            "You are analyzing a Singapore food influencer video. Reply with ONLY valid JSON, no markdown, no explanation.\n\n" +
            "Fields to return:\n" +
            '- dish_name: string (main dish, e.g. "Wagyu Omakase", "Char Kway Teow")\n' +
            '- price: string or null (e.g. "$8.50", "SGD 158 per pax")\n' +
            '- cuisine: one of: chinese, japanese, korean, local, malay, thai, western\n' +
            '- price_band: one of: cheap (under SGD15), mid (SGD15-40), treat (above SGD40)\n' +
            '- vibe: one of: comfort, date-night, hawker, spicy, supper, sweet\n' +
            '- pull_quote: a verbatim short quote from the transcript that describes the food itself (taste, texture, appearance) — under 100 chars, or null if none fits\n' +
            '- sentiment: one of: positive, neutral, negative\n\n' +
            context,
        },
      ],
    },
  });

  let parsed;
  try {
    const raw = response?.choices?.[0]?.message?.content?.trim() || "{}";
    const cleaned = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return FALLBACK_META;
  }

  return {
    dish_name: String(parsed.dish_name || "Unknown dish").slice(0, 200),
    price: parsed.price ? String(parsed.price).slice(0, 50) : null,
    tags: {
      cuisine: CUISINE_TAGS.includes(parsed.cuisine) ? parsed.cuisine : "local",
      priceBand: PRICE_BAND_TAGS.includes(parsed.price_band) ? parsed.price_band : "mid",
      vibe: VIBE_TAGS.includes(parsed.vibe) ? parsed.vibe : "comfort",
    },
    pull_quote: parsed.pull_quote ? String(parsed.pull_quote).slice(0, 200) : null,
    sentiment: ["positive", "neutral", "negative"].includes(parsed.sentiment) ? parsed.sentiment : "neutral",
  };
}

// ── Engagement score ──────────────────────────────────────────────────────────

function computeEngagementScore(reel) {
  const raw = (reel.likes || 0) + (reel.comments || 0) * 2 + (reel.shares || 0) * 3;
  const hoursSince = Math.max(1, (Date.now() - new Date(reel.posted_at).getTime()) / 3_600_000);
  return raw / hoursSince;
}

// ── Concurrency helper ────────────────────────────────────────────────────────

async function runConcurrent(items, fn, limit) {
  const results = new Array(items.length);
  const executing = new Set();
  let i = 0;
  for (const item of items) {
    const idx = i++;
    const p = fn(item).then((r) => { executing.delete(p); results[idx] = r; });
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.allSettled(executing);
  return results;
}

// ── Per-reel processor ────────────────────────────────────────────────────────

async function processReel(reel, { adapter, summary }) {
  const reelId = reel.reel_id;

  const log = (action, extra = {}) => {
    const entry = { reel_id: reelId, action, ...extra };
    summary.rows.push(entry);
    const detail = extra.reason ? `: ${extra.reason}` : extra.dish_name ? ` dish="${extra.dish_name}"` : "";
    console.log(`  [${reelId}] ${action}${detail}`);
  };

  try {
    if (!overwrite) {
      const exists = await clipExistsForReel(reelId);
      if (exists) {
        summary.skipped++;
        log("skipped", { reason: "clip already exists for this reel" });
        return;
      }
    }

    // Step 1: VideoDB — upload, index, search
    let evidence = {
      processing_status: "skipped",
      best_clip: null,
      tokenrouter_input: {},
      quote_candidates: [],
      errors: [],
    };

    if (adapter) {
      const post = {
        post_id: reelId,
        video_url: reel.video_url,
        caption: reel.caption || "",
        creator_handle: reel.creator_handle || "",
        posted_at: reel.posted_at,
        engagement: {
          likes: reel.likes || 0,
          comments: reel.comments || 0,
          shares: reel.shares || 0,
          views: reel.views || 0,
        },
        source_url: reel.url || reel.video_url || "",
      };

      evidence = await processPost(post, { adapter, searchAttempts, searchDelayMs });
      const errSummary = evidence.errors.length ? ` (${evidence.errors.join("; ")})` : " (ok)";
      console.log(`  [${reelId}] videodb: ${evidence.processing_status}${errSummary}`);
    }

    // Always fetch the full transcript with word timestamps from VideoDB
    let transcript = "";
    let transcriptWords = [];
    if (adapter && evidence.video_id) {
      try {
        const result = await adapter.getTranscriptWithTimestamps(evidence.video_id);
        transcript = result.text || "";
        transcriptWords = result.words || [];
        console.log(`  [${reelId}] transcript: ${transcript.length} chars, ${transcriptWords.length} words`);
      } catch (err) {
        console.log(`  [${reelId}] transcript fetch failed: ${err.message}`);
      }
    }
    if (!transcript && reel.transcript) {
      transcript = reel.transcript;
      console.log(`  [${reelId}] transcript: using existing raw_reels value (${transcript.length} chars)`);
    }

    // Discard transcript if it's mostly CJK — likely background music lyrics, not useful
    if (transcript) {
      const cjkCount = (transcript.match(/[一-鿿぀-ヿ]/g) || []).length;
      if (cjkCount / transcript.length > 0.4) {
        console.log(`  [${reelId}] transcript: discarded (${Math.round(cjkCount/transcript.length*100)}% CJK — likely background music)`);
        transcript = "";
        transcriptWords = [];
      }
    }

    const bestClip = evidence.best_clip;

    // Step 2: Save transcript back to raw_reels
    if (transcript && write) {
      await saveTranscript(reelId, transcript);
    }

    // Step 3: LLM metadata extraction
    const meta = await extractClipMeta(reel.caption, transcript, evidence.quote_candidates);
    console.log(
      `  [${reelId}] meta: dish="${meta.dish_name}" cuisine=${meta.tags.cuisine} priceBand=${meta.tags.priceBand} vibe=${meta.tags.vibe} sentiment=${meta.sentiment}`,
    );

    // Step 4: Build and insert clip row
    const quoteStart = meta.pull_quote ? findQuoteStart(transcriptWords, meta.pull_quote) : null;
    if (meta.pull_quote) console.log(`  [${reelId}] pull_quote: "${meta.pull_quote}" → clip_start=${quoteStart ?? "not found"}`);
    const clipStart = quoteStart ?? (bestClip ? bestClip.start : null);
    const clipDuration = bestClip ? (bestClip.end - bestClip.start) : 18;
    const clipEnd = clipStart != null ? clipStart + clipDuration : (bestClip ? bestClip.end : null);

    const clipRow = {
      reel_id: reelId,
      place_id: reel.place_id || null,
      dish_name: meta.dish_name,
      price: meta.price,
      video_url: reel.video_url,
      stream_url: evidence.stream_url || null,
      clip_start: clipStart != null ? Math.round(clipStart) : null,
      clip_end: clipEnd != null ? Math.round(clipEnd) : null,
      transcript: transcript || null,
      influencer: reel.creator_handle || "",
      posted_at: reel.posted_at,
      caption: reel.caption || null,
      tags: meta.tags,
      pull_quote: meta.pull_quote,
      sentiment: meta.sentiment,
      likes: reel.likes || 0,
      comments: reel.comments || 0,
      shares: reel.shares || 0,
      views: reel.views || 0,
      engagement_score: computeEngagementScore(reel),
    };

    if (write) {
      await insertClip(clipRow);
      await markReelProcessed(reelId);
      summary.inserted++;
      log("inserted", {
        dish_name: meta.dish_name,
        clip_start: clipRow.clip_start,
        clip_end: clipRow.clip_end,
        place_id: clipRow.place_id,
      });
    } else {
      log("would_insert", {
        dish_name: meta.dish_name,
        clip_start: clipRow.clip_start,
        clip_end: clipRow.clip_end,
        place_id: clipRow.place_id,
      });
    }
  } catch (err) {
    summary.failed++;
    log("failed", { reason: err.message });
    if (write) {
      await saveReelError(reelId, err.message);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const reels = await fetchUnprocessedReels(limit, includeProcessed);
console.log(`Fetched ${reels.length} raw_reel(s) (limit=${limit}, concurrency=${concurrency}, write=${write})`);

const summary = {
  dryRun: !write,
  checked: reels.length,
  inserted: 0,
  skipped: 0,
  failed: 0,
  rows: [],
};

if (!reels.length) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

let adapter = null;
if (!skipVideodb) {
  adapter = await createVideoDbAdapter();
}

await runConcurrent(reels, (reel) => processReel(reel, { adapter, summary }), concurrency);

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.failed > 0 && summary.inserted === 0 ? 1 : 0);
