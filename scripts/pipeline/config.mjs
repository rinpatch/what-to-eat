import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

function parseEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

export function loadDotEnv() {
  parseEnvFile(join(repoRoot, ".env"));
  parseEnvFile(join(repoRoot, ".env.local"));
}

export function requireEnv(name) {
  loadDotEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env first.`);
  }
  return value;
}

export function optionalNumber(name) {
  loadDotEnv();
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function pipelineConfig() {
  loadDotEnv();
  return {
    brightData: {
      apiToken: process.env.BRIGHTDATA_API_TOKEN || "",
      datasetId: process.env.BRIGHTDATA_DATASET_ID || "gd_lyclm20il4r5helnj",
      baseUrl: "https://api.brightdata.com/datasets/v3",
    },
    videoDb: {
      collectionId: process.env.VIDEODB_COLLECTION_ID || "default",
    },
    kimi: {
      apiKey: process.env.KIMI_API_KEY || "",
      baseUrl: process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1",
      model: process.env.KIMI_MODEL || "kimi-k2.7-code",
    },
    maps: {
      apiKey: process.env.GOOGLE_MAPS_API_KEY || "",
      region: process.env.GOOGLE_MAPS_REGION || "",
      userLat: optionalNumber("USER_LAT"),
      userLng: optionalNumber("USER_LNG"),
    },
  };
}
