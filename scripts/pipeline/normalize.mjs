import { createHash } from "node:crypto";

function pick(row, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((item, part) => item?.[part], row);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function numberFrom(row, keys) {
  const value = pick(row, keys);
  if (value === null) return 0;
  const parsed = parseCount(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringFrom(row, keys) {
  const value = pick(row, keys);
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  if (typeof value === "object" && value?.text) return value.text;
  return value ? String(value) : "";
}

function stableId(...parts) {
  return createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex");
}

function parseCount(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number(value);

  const normalized = value.trim().replace(/,/g, "").toLowerCase();
  const match = normalized.match(/^([\d.]+)\s*([km])?$/);
  if (!match) return Number(normalized);

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return 0;
  if (match[2] === "k") return base * 1_000;
  if (match[2] === "m") return base * 1_000_000;
  return base;
}

function parsePostTime(value) {
  if (!value) return 0;
  if (typeof value === "number") {
    return value > 10_000_000_000 ? value : value * 1_000;
  }

  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return numeric > 10_000_000_000 ? numeric : numeric * 1_000;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isLikelyVideoPost(row) {
  const type = String(
    pick(row, [
      "type",
      "post_type",
      "product_type",
      "media_type",
      "__typename",
    ]) || "",
  ).toLowerCase();

  if (type.includes("reel") || type.includes("video")) return true;
  if (pick(row, ["video_url", "videoUrl", "video_versions", "video_resources"])) {
    return true;
  }
  return numberFrom(row, ["video_view_count", "video_play_count", "play_count", "views"]) > 0;
}

function firstMediaUrl(row) {
  const direct = pick(row, [
    "video_url",
    "videoUrl",
    "video_url_downloadable",
    "video_download_url",
    "display_url",
    "thumbnail_url",
    "thumbnailUrl",
  ]);
  if (direct) return String(direct);

  const candidates = [
    row.video_versions,
    row.video_resources,
    row.video_resources_urls,
    row.images,
    row.photos,
  ].flatMap((value) => (Array.isArray(value) ? value : []));
  const media = candidates.find((item) => item?.url || typeof item === "string");
  return typeof media === "string" ? media : media?.url || "";
}

export function normalizeInstagramReel(row, creator = {}) {
  const url = stringFrom(row, ["url", "post_url", "shortcode_url", "permalink"]);
  const shortcode = stringFrom(row, ["shortcode", "id", "post_id"]);
  const creatorUsername =
    stringFrom(row, ["owner_username", "username", "user.username", "author"]) ||
    creator.handle ||
    "";
  const caption = stringFrom(row, [
    "caption",
    "description",
    "text",
    "title",
    "edge_media_to_caption.edges.0.node.text",
  ]);
  const mediaUrl = firstMediaUrl(row);
  const publishedAt = stringFrom(row, [
    "timestamp",
    "taken_at",
    "date_posted",
    "published_at",
    "created_at",
  ]);

  return {
    id: stableId(url, shortcode, creatorUsername, mediaUrl, caption.slice(0, 80)),
    platform: "instagram",
    creatorUsername,
    creatorUrl: creator.url || (creatorUsername ? `https://www.instagram.com/${creatorUsername}` : ""),
    url,
    shortcode,
    caption,
    mediaUrl,
    thumbnailUrl:
      stringFrom(row, ["thumbnail_url", "thumbnailUrl", "display_url", "image_url"]) ||
      mediaUrl,
    publishedAt: publishedAt || null,
    metrics: {
      likes: numberFrom(row, ["likes", "like_count", "likes_count", "edge_media_preview_like.count"]),
      comments: numberFrom(row, ["comments", "comment_count", "comments_count", "edge_media_to_comment.count"]),
      sends: numberFrom(row, ["sends", "send_count", "share_count", "shares"]),
      reposts: numberFrom(row, ["reposts", "repost_count", "reshare_count", "reshare_count_int"]),
      views: numberFrom(row, ["views", "view_count", "video_view_count", "video_play_count", "play_count"]),
    },
    raw: row,
  };
}

export function latestPerCreator(reels, limit = 20) {
  const groups = new Map();
  for (const reel of reels) {
    const key = reel.creatorUsername || reel.creatorUrl || "unknown";
    groups.set(key, [...(groups.get(key) || []), reel]);
  }

  return [...groups.values()].flatMap((items) =>
    items
      .sort((a, b) => {
        const left = parsePostTime(a.publishedAt);
        const right = parsePostTime(b.publishedAt);
        return right - left;
      })
      .slice(0, limit),
  );
}
