import { loadDotEnv, requireEnv } from "./config.mjs";

export const RAW_REEL_VIDEODB_PATCH_COLUMNS = [
  "transcript",
  "processing_error",
  "processed",
];

export function rawReelsToVideoDbPosts(rawReels, creatorsById = {}) {
  return rawReels
    .filter((row) => row?.video_url || row?.url)
    .map((row) => {
      const handle = creatorsById[row.creator_id] || row.creator_handle || row.creatorUsername || "";
      const normalizedHandle = handle ? (String(handle).startsWith("@") ? String(handle) : "@" + handle) : "";
      return {
        post_id: row.reel_id,
        video_url: row.video_url || row.url,
        caption: row.caption || "",
        creator_handle: normalizedHandle,
        posted_at: row.posted_at || null,
        engagement: {
          likes: row.likes ?? 0,
          comments: row.comments ?? 0,
          shares: row.shares ?? 0,
          views: row.views ?? 0,
        },
        source_url: row.url || row.video_url || "",
      };
    });
}

export async function fetchRawReelsForVideoDb({ limit = 5, includeProcessed = false } = {}) {
  loadDotEnv();
  const rawBaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
  };

  let rows = await fetchRawReels(baseUrl, headers, { limit, includeProcessed });
  if (!rows.length && !includeProcessed) {
    rows = await fetchRawReels(baseUrl, headers, { limit, includeProcessed: true });
  }

  const creatorIds = [...new Set(rows.map((row) => row.creator_id).filter(Boolean))];
  const creatorsById = creatorIds.length ? await fetchCreatorsById(baseUrl, headers, creatorIds) : {};
  return rawReelsToVideoDbPosts(rows, creatorsById);
}

export function transcriptFromVideoDbEvidence(row) {
  const fromTokenRouterInput = row?.tokenrouter_input?.spoken_text;
  if (fromTokenRouterInput && String(fromTokenRouterInput).trim()) {
    return String(fromTokenRouterInput).replace(/\s+/g, " ").trim();
  }

  const snippets = Array.isArray(row?.transcript_snippets) ? row.transcript_snippets : [];
  return snippets
    .map((snippet) => String(snippet?.text || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDemoVideoDbEvidence(row) {
  return String(row?.video_id || "").startsWith("demo-vdb");
}

export function videoDbEvidenceToRawReelPatch(row, options = {}) {
  const transcript = transcriptFromVideoDbEvidence(row);
  const errors = Array.isArray(row?.errors) ? row.errors.filter(Boolean) : [];
  const patch = {};

  if (transcript) patch.transcript = transcript;
  patch.processing_error = errors.length
    ? `VideoDB ${row?.processing_status || "partial"}: ${errors.join("; ")}`.slice(0, 2000)
    : null;

  if (options.markProcessed) {
    patch.processed = ["complete", "partial"].includes(row?.processing_status);
  }

  return {
    reel_id: row?.post_id || null,
    patch,
  };
}

export async function updateRawReelsWithVideoDbEvidence(evidenceRows, options = {}) {
  loadDotEnv();
  const rawBaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    "Content-Type": "application/json",
  };
  const {
    dryRun = true,
    limit = null,
    overwrite = false,
    markProcessed = false,
    allowDemo = false,
  } = options;

  const selectedRows = Number.isFinite(limit) ? evidenceRows.slice(0, limit) : evidenceRows;
  const summary = {
    dryRun,
    checked: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    rows: [],
  };

  for (const row of selectedRows) {
    summary.checked += 1;

    if (isDemoVideoDbEvidence(row) && !allowDemo) {
      summary.skipped += 1;
      summary.rows.push({ post_id: row?.post_id || null, action: "skipped", reason: "demo evidence is not written to Supabase" });
      continue;
    }

    const { reel_id: reelId, patch } = videoDbEvidenceToRawReelPatch(row, { markProcessed });
    if (!reelId) {
      summary.skipped += 1;
      summary.rows.push({ post_id: null, action: "skipped", reason: "missing post_id/reel_id" });
      continue;
    }

    const hasTranscript = Boolean(patch.transcript);
    const hasError = Boolean(patch.processing_error);
    if (!hasTranscript && !hasError) {
      summary.skipped += 1;
      summary.rows.push({ post_id: reelId, action: "skipped", reason: "no transcript or VideoDB error to write" });
      continue;
    }

    try {
      const existing = await fetchRawReelById(baseUrl, headers, reelId);
      if (!existing) {
        summary.skipped += 1;
        summary.rows.push({ post_id: reelId, action: "skipped", reason: "raw_reels row not found" });
        continue;
      }

      if (existing.transcript && !overwrite) {
        summary.skipped += 1;
        summary.rows.push({ post_id: reelId, action: "skipped", reason: "transcript already exists" });
        continue;
      }

      if (dryRun) {
        summary.rows.push({ post_id: reelId, action: "would_update", columns: Object.keys(patch) });
        continue;
      }

      await patchRawReel(baseUrl, headers, reelId, patch);
      summary.updated += 1;
      summary.rows.push({ post_id: reelId, action: "updated", columns: Object.keys(patch) });
    } catch (error) {
      summary.failed += 1;
      summary.rows.push({ post_id: reelId, action: "failed", reason: error.message });
    }
  }

  return summary;
}

async function fetchRawReels(baseUrl, headers, { limit, includeProcessed }) {
  const url = new URL(baseUrl + "/rest/v1/raw_reels");
  url.searchParams.set(
    "select",
    "reel_id,creator_id,url,video_url,caption,likes,comments,shares,views,posted_at,processed",
  );
  url.searchParams.set("video_url", "not.is.null");
  if (!includeProcessed) url.searchParams.set("processed", "eq.false");
  url.searchParams.set("order", "posted_at.desc");
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error("Failed to fetch raw_reels: " + response.status + " " + text.slice(0, 500));
  }
  return text ? JSON.parse(text) : [];
}

async function fetchRawReelById(baseUrl, headers, reelId) {
  const url = new URL(baseUrl + "/rest/v1/raw_reels");
  url.searchParams.set("select", "reel_id,transcript,processing_error,processed");
  url.searchParams.set("reel_id", "eq." + reelId);
  url.searchParams.set("limit", "1");

  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error("Failed to fetch raw_reels row: " + response.status + " " + text.slice(0, 500));
  }
  const rows = text ? JSON.parse(text) : [];
  return rows[0] || null;
}

async function patchRawReel(baseUrl, headers, reelId, patch) {
  const url = new URL(baseUrl + "/rest/v1/raw_reels");
  url.searchParams.set("reel_id", "eq." + reelId);

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      ...headers,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error("Failed to update raw_reels row: " + response.status + " " + text.slice(0, 500));
  }
}

async function fetchCreatorsById(baseUrl, headers, creatorIds) {
  const url = new URL(baseUrl + "/rest/v1/creators");
  url.searchParams.set("select", "id,handle");
  url.searchParams.set("id", "in.(" + creatorIds.join(",") + ")");

  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error("Failed to fetch creators: " + response.status + " " + text.slice(0, 500));
  }
  const rows = text ? JSON.parse(text) : [];
  return Object.fromEntries(rows.map((row) => [row.id, row.handle]));
}
