import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repoRoot } from "./config.mjs";

export const paths = {
  dataDir: join(repoRoot, "data"),
  rawDir: join(repoRoot, "data", "raw"),
  brightDataRawDir: join(repoRoot, "data", "raw", "brightdata"),
  creators: join(repoRoot, "data", "creators.json"),
  jobs: join(repoRoot, "data", "brightdata_jobs.json"),
  pipelineDb: join(repoRoot, "data", "pipeline-db.json"),
  recommendations: join(repoRoot, "data", "recommendations.json"),
  seedPosts: join(repoRoot, "data", "seed_posts.json"),
  seedPostsExample: join(repoRoot, "data", "seed_posts.example.json"),
  videoDbEvidence: join(repoRoot, "data", "videodb_evidence.json"),
};

export function emptyPipelineDb() {
  return {
    updatedAt: null,
    reels: [],
    transcripts: {},
    structured: {},
    places: {},
    recommendations: [],
    videoDbEvidence: {},
  };
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(path, value) {
  await ensureDir(dirname(path));
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmpPath, path);
}

export async function readPipelineDb() {
  return readJson(paths.pipelineDb, emptyPipelineDb());
}

export async function writePipelineDb(db) {
  db.updatedAt = new Date().toISOString();
  await writeJson(paths.pipelineDb, db);
}

export function mergeById(existing, incoming) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
  }
  return [...byId.values()];
}
