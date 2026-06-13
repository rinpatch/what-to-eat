import { join } from "node:path";
import {
  mergeById,
  paths,
  readJson,
  readPipelineDb,
  writeJson,
  writePipelineDb,
} from "./pipeline/fsdb.mjs";
import {
  downloadSnapshot,
  fetchSnapshotProgress,
  normalizeSnapshotRows,
} from "./pipeline/brightdata.mjs";

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
  const progress = force ? { status: "forced" } : await fetchSnapshotProgress(job.snapshotId);
  if (!force && !isComplete(progress)) {
    job.status = progress?.status || progress?.state || "pending";
    job.progress = progress;
    console.log(`  not ready: ${job.status}`);
    continue;
  }

  const snapshot = await downloadSnapshot(job.snapshotId);
  const rawPath = join(paths.brightDataRawDir, `${job.snapshotId}.json`);
  await writeJson(rawPath, snapshot);
  const reels = normalizeSnapshotRows(snapshot, job.creator);
  db.reels = mergeById(db.reels, reels);
  job.status = "downloaded";
  job.downloadedAt = new Date().toISOString();
  job.rawPath = rawPath;
  job.reelCount = reels.length;
  downloaded += 1;
  console.log(`  normalized ${reels.length} reels`);
}

if (!snapshotArg) await writeJson(paths.jobs, jobs);
await writePipelineDb(db);
console.log(`Downloaded ${downloaded} snapshots. Pipeline DB has ${db.reels.length} reels.`);
