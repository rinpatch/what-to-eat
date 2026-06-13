import { paths } from "./pipeline/fsdb.mjs";
import { fetchRawReelsForVideoDb } from "./pipeline/supabase-rest.mjs";
import { createVideoDbAdapter } from "./pipeline/videodb.mjs";
import { buildVideoDbCacheFromPosts } from "./pipeline/videodb-cache.mjs";

function argValue(name) {
  const prefix = "--" + name + "=";
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

function hasFlag(name) {
  return process.argv.includes("--" + name);
}

const demo = hasFlag("demo");
const includeProcessed = hasFlag("include-processed");
const limit = Number(argValue("limit") || 1);
const output = argValue("output") || paths.videoDbSupabaseSmoke;

const posts = await fetchRawReelsForVideoDb({ limit, includeProcessed });
console.log("Fetched " + posts.length + " Supabase raw_reels candidate(s) with video_url");

if (!posts.length) {
  console.log("No Supabase raw_reels rows available for VideoDB smoke test.");
  process.exit(0);
}

const adapter = demo ? null : await createVideoDbAdapter();
const rows = await buildVideoDbCacheFromPosts(posts, {
  adapter,
  demo,
  output,
  limit,
  retryFailed: true,
  skipComplete: false,
  searchAttempts: Number(argValue("search-attempts") || (demo ? 1 : 2)),
  searchDelayMs: Number(argValue("search-delay-ms") || (demo ? 0 : 5000)),
});

const counts = rows.reduce((acc, row) => {
  acc[row.processing_status] = (acc[row.processing_status] || 0) + 1;
  return acc;
}, {});
console.log(
  "Supabase -> VideoDB smoke wrote " + rows.length + " row(s) to " + output +
    " (" + (counts.complete || 0) + " complete, " + (counts.partial || 0) +
    " partial, " + (counts.failed || 0) + " failed)",
);
