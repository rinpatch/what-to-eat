import { join } from "node:path";
import {
  mergeById,
  paths,
  readJson,
  readPipelineDb,
  writeJson,
  writePipelineDb,
} from "./pipeline/fsdb.mjs";
import { loadDotEnv } from "./pipeline/config.mjs";
import {
  normalizeSnapshotRows,
  triggerInstagramDiscovery,
} from "./pipeline/brightdata.mjs";
import { upsertReels } from "./pipeline/supabase.mjs";

loadDotEnv();

function normalizeCreatorUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(url || "").replace(/\/$/, "");
  }
}

function creatorsFromArgs() {
  return process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("http"))
    .map((url) => ({
      handle: url.split("/").filter(Boolean).at(-1) || url,
      url,
      enabled: true,
      targetReels: 20,
    }));
}

const force = process.argv.includes("--force");
const configuredCreators = creatorsFromArgs();
const creators =
  configuredCreators.length > 0
    ? configuredCreators
    : (await readJson(paths.creators, [])).filter((creator) => creator.enabled !== false);

if (!creators.length) {
  throw new Error("No creators configured. Add Instagram account URLs to data/creators.json.");
}

const existingJobs = await readJson(paths.jobs, []);
const jobs = [...existingJobs];
const db = await readPipelineDb();
let normalizedCount = 0;

for (const creator of creators) {
  const creatorKey = normalizeCreatorUrl(creator.url);
  const existingActiveJob = jobs.find(
    (job) =>
      normalizeCreatorUrl(job.creator?.url) === creatorKey &&
      !["failed", "downloaded"].includes(job.status),
  );

  if (existingActiveJob && !force) {
    console.log(
      `Skipping ${creator.url}; active snapshot ${existingActiveJob.snapshotId || "pending"} already exists. Use --force to trigger again.`,
    );
    continue;
  }

  console.log(`Triggering Bright Data discovery for ${creator.url}`);
  try {
    const job = await triggerInstagramDiscovery(creator);
    if (job.status === "downloaded" && job.rows?.length) {
      const rawPath = join(paths.brightDataRawDir, `${job.snapshotId}.json`);
      await writeJson(rawPath, job.rows);
      const reels = normalizeSnapshotRows(job.rows, creator);
      db.reels = mergeById(db.reels, reels);
      normalizedCount += reels.length;
      job.rawPath = rawPath;
      job.reelCount = reels.length;
      delete job.rows;
      console.log(`  received ${reels.length} reels directly`);
      try {
        const { upserted, skipped } = await upsertReels(reels);
        console.log(`  supabase: upserted ${upserted}, skipped ${skipped}`);
      } catch (err) {
        console.warn(`  supabase upsert failed: ${err.message}`);
      }
    }
    jobs.push(job);
    console.log(`  snapshot: ${job.snapshotId}`);
  } catch (error) {
    jobs.push({
      creator,
      snapshotId: null,
      status: "failed",
      failedAt: new Date().toISOString(),
      error: error.message,
      response:
        typeof error.response === "string"
          ? error.response.slice(0, 1000)
          : error.response || null,
    });
    console.log(`  failed: ${error.message}`);
  }
}

await writeJson(paths.jobs, jobs);
if (normalizedCount > 0) await writePipelineDb(db);
console.log(`Saved ${jobs.length} Bright Data job records to data/brightdata_jobs.json`);
