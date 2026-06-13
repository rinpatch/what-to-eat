import { pipelineConfig, requireAnyEnv } from "./config.mjs";
import { fetchJson } from "./http.mjs";
import {
  isLikelyVideoPost,
  latestPerCreator,
  normalizeInstagramReel,
} from "./normalize.mjs";

export function extractSnapshotId(response) {
  if (!response) return null;
  return (
    response.snapshot_id ||
    response.snapshotId ||
    response.id ||
    response.data?.snapshot_id ||
    response.data?.id ||
    response.result?.snapshot_id ||
    null
  );
}

export async function triggerInstagramDiscovery(creator) {
  const config = pipelineConfig();
  const token = requireAnyEnv(["BRIGHTDATA_API_TOKEN", "BRIGHT_DATA_API_KEY"]);
  const url = new URL(`${config.brightData.baseUrl}/scrape`);
  url.searchParams.set("dataset_id", config.brightData.datasetId);
  url.searchParams.set("notify", "false");
  url.searchParams.set("include_errors", "true");
  url.searchParams.set("type", "discover_new");
  url.searchParams.set("discover_by", "url_all_reels");

  const response = await fetchJson(url, {
    headers: { Authorization: `Bearer ${token}` },
    body: {
      input: [
        {
          url: creator.url,
          num_of_posts: Number(creator.targetReels || 20),
          start_date: creator.start_date || "",
          end_date: creator.end_date || "",
        },
      ],
    },
    retries: 1,
  });

  const snapshotId = extractSnapshotId(response);
  const directRows = Array.isArray(response)
    ? response
    : Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response?.results)
        ? response.results
        : null;

  if (directRows?.length) {
    return {
      creator,
      snapshotId: `direct_${Date.now()}`,
      status: "downloaded",
      triggeredAt: new Date().toISOString(),
      downloadedAt: new Date().toISOString(),
      rows: directRows,
      response: {
        mode: "direct",
        rowCount: directRows.length,
      },
    };
  }

  if (!snapshotId) {
    const error = new Error(
      `Bright Data did not return a snapshot ID for ${creator.url}`,
    );
    error.response = response;
    throw error;
  }

  return {
    creator,
    snapshotId,
    status: "triggered",
    triggeredAt: new Date().toISOString(),
    response,
  };
}

export async function fetchSnapshotProgress(snapshotId) {
  const config = pipelineConfig();
  const token = requireAnyEnv(["BRIGHTDATA_API_TOKEN", "BRIGHT_DATA_API_KEY"]);
  return fetchJson(`${config.brightData.baseUrl}/progress/${snapshotId}`, {
    headers: { Authorization: `Bearer ${token}` },
    retries: 0,
  });
}

export async function downloadSnapshot(snapshotId) {
  const config = pipelineConfig();
  const token = requireAnyEnv(["BRIGHTDATA_API_TOKEN", "BRIGHT_DATA_API_KEY"]);
  const url = new URL(`${config.brightData.baseUrl}/snapshot/${snapshotId}`);
  url.searchParams.set("format", "json");
  return fetchJson(url, {
    headers: { Authorization: `Bearer ${token}` },
    retries: 1,
    timeoutMs: 180_000,
  });
}

export function normalizeSnapshotRows(rows, creator) {
  const list = Array.isArray(rows) ? rows : rows?.data || rows?.results || [];
  const limit = Number(creator?.targetReels || 20);
  return latestPerCreator(
    list
      .filter((row) => row && typeof row === "object")
      .filter(isLikelyVideoPost)
      .map((row) => normalizeInstagramReel(row, creator))
      .filter((reel) => reel.url && (reel.mediaUrl || reel.metrics.views > 0)),
    Number.isFinite(limit) ? limit : 20,
  );
}
