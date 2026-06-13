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
  downloadSnapshot,
  fetchSnapshotProgress,
  normalizeSnapshotRows,
} from "./pipeline/brightdata.mjs";
import { upsertReels } from "./pipeline/supabase.mjs";

loadDotEnv();

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

function isComplete(progress) {
  const status = String(
    progress?.status || progress?.state || progress?.status_text || "",
  ).toLowerCase();
  return (
    ["ready", "done", "success", "completed", "complete"].includes(status) ||
    progress?.completed === true ||
    progress?.progress === 100
  );
}

const snapshotArg = argValue("snapshot");
const force = process.argv.includes("--force");
let jobs = await readJson(paths.jobs, []);

if (snapshotArg) {
  jobs = [
    {
      creator: {
        handle: argValue("handle"),
        url: argValue("creator"),
      },
      snapshotId: snapshotArg,
      status: "manual",
      triggeredAt: null,
    },
  ];
}

if (!jobs.length) {
  throw new Error("No Bright Data jobs found. Run scripts/ingest-brightdata.mjs first.");
}

const db = await readPipelineDb();
let downloaded = 0;

for (const job of jobs) {
  if (!job.snapshotId) continue;
  if (!force && job.status === "downloaded") continue;

  console.log(`Checking snapshot ${job.snapshotId}`);

  // direct_* snapshots were returned synchronously by Bright Data and saved to disk
  const isDirect = job.snapshotId.startsWith("direct_");
  let snapshot;
  let rawPath;

  if (isDirect) {
    rawPath = job.rawPath || join(paths.brightDataRawDir, `${job.snapshotId}.json`);
    snapshot = await readJson(rawPath, null);
    if (!snapshot) {
      console.log(`  no raw file found for direct snapshot, skipping`);
      continue;
    }
  } else {
    const progress = force ? { status: "forced" } : await fetchSnapshotProgress(job.snapshotId);
    if (!force && !isComplete(progress)) {
      job.status = progress?.status || progress?.state || "pending";
      job.progress = progress;
      console.log(`  not ready: ${job.status}`);
      continue;
    }
    snapshot = await downloadSnapshot(job.snapshotId);
    rawPath = join(paths.brightDataRawDir, `${job.snapshotId}.json`);
    await writeJson(rawPath, snapshot);
  }
  const reels = normalizeSnapshotRows(snapshot, job.creator);
  db.reels = mergeById(db.reels, reels);
  if (!isDirect) {
    job.status = "downloaded";
    job.downloadedAt = new Date().toISOString();
    job.rawPath = rawPath;
  }
  job.reelCount = reels.length;
  downloaded += 1;
  console.log(`  normalized ${reels.length} reels`);

  try {
    const { upserted, skipped } = await upsertReels(reels);
    console.log(`  supabase: upserted ${upserted}, skipped ${skipped}`);
  } catch (err) {
    console.warn(`  supabase upsert failed: ${err.message}`);
  }
}

if (!snapshotArg) await writeJson(paths.jobs, jobs);
await writePipelineDb(db);
console.log(`Downloaded ${downloaded} snapshots. Pipeline DB has ${db.reels.length} reels.`);
