import { readJson, paths } from "./pipeline/fsdb.mjs";
import { resolveRepoPath } from "./pipeline/videodb-cache.mjs";
import { updateRawReelsWithVideoDbEvidence } from "./pipeline/supabase-rest.mjs";

function argValue(name) {
  const prefix = "--" + name + "=";
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

function hasFlag(name) {
  return process.argv.includes("--" + name);
}

const input = argValue("input") || paths.videoDbEvidence;
const limitValue = argValue("limit");
const rows = await readJson(resolveRepoPath(input, paths.videoDbEvidence), []);
if (!Array.isArray(rows)) throw new Error("VideoDB evidence input must be a JSON array");

const summary = await updateRawReelsWithVideoDbEvidence(rows, {
  dryRun: !hasFlag("write"),
  overwrite: hasFlag("overwrite"),
  markProcessed: hasFlag("mark-processed"),
  allowDemo: hasFlag("allow-demo"),
  limit: limitValue ? Number(limitValue) : null,
});

console.log(JSON.stringify(summary, null, 2));
