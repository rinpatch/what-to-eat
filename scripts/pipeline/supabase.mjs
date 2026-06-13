import { createClient } from "@supabase/supabase-js";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

let _client = null;
function client() {
  if (!_client) _client = getClient();
  return _client;
}

// Returns a map of handle -> creator_id, upserting missing creators on the fly
async function resolveCreatorIds(reels) {
  const creatorsByHandle = new Map();
  for (const reel of reels) {
    if (reel.creatorUsername && !creatorsByHandle.has(reel.creatorUsername)) {
      creatorsByHandle.set(reel.creatorUsername, {
        handle: reel.creatorUsername,
        platform: reel.platform || "instagram",
        profile_url: reel.creatorUrl || null,
      });
    }
  }

  const handles = [...creatorsByHandle.keys()];
  if (!handles.length) return {};

  // Upsert so unknown creators are created automatically
  const { error: upsertError } = await client()
    .from("creators")
    .upsert([...creatorsByHandle.values()], { onConflict: "handle", ignoreDuplicates: true });
  if (upsertError) throw new Error(`Failed to upsert creators: ${upsertError.message}`);

  const { data, error } = await client()
    .from("creators")
    .select("id, handle")
    .in("handle", handles);
  if (error) throw new Error(`Failed to fetch creators: ${error.message}`);
  return Object.fromEntries(data.map((row) => [row.handle, row.id]));
}

// Upserts normalized reels (from normalize.mjs) into raw_reels.
// Skips reels where creator_id cannot be resolved.
export async function upsertReels(reels) {
  if (!reels.length) return { upserted: 0, skipped: 0 };

  const creatorIds = await resolveCreatorIds(reels);

  const rows = [];
  let skipped = 0;

  for (const reel of reels) {
    const creatorId = creatorIds[reel.creatorUsername];
    if (!creatorId) {
      skipped++;
      continue;
    }

    const postedAt = reel.publishedAt ? new Date(reel.publishedAt).toISOString() : null;
    if (!postedAt) {
      skipped++;
      continue;
    }

    rows.push({
      reel_id: reel.id,
      creator_id: creatorId,
      url: reel.url,
      video_url: reel.mediaUrl || null,
      caption: reel.caption || null,
      likes: reel.metrics?.likes ?? 0,
      comments: reel.metrics?.comments ?? 0,
      shares: (reel.metrics?.sends ?? 0) + (reel.metrics?.reposts ?? 0),
      views: reel.metrics?.views ?? 0,
      posted_at: postedAt,
    });
  }

  if (!rows.length) return { upserted: 0, skipped };

  const { error } = await client()
    .from("raw_reels")
    .upsert(rows, { onConflict: "reel_id", ignoreDuplicates: false });

  if (error) throw new Error(`Failed to upsert raw_reels: ${error.message}`);

  return { upserted: rows.length, skipped };
}
