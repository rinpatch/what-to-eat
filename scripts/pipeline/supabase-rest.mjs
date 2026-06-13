import { loadDotEnv, requireEnv } from "./config.mjs";

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
