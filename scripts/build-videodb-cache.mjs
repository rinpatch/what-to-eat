import { createVideoDbAdapter } from "./pipeline/videodb.mjs";
import { buildVideoDbCache } from "./pipeline/videodb-cache.mjs";

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const demo = hasFlag("demo");
const input = argValue("input");
const output = argValue("output") || "data/videodb_evidence.json";
const limitValue = argValue("limit");
const searchAttemptsValue = argValue("search-attempts");
const searchDelayValue = argValue("search-delay-ms");

const adapter = demo ? null : await createVideoDbAdapter();
const rows = await buildVideoDbCache({
  adapter,
  demo,
  input,
  output,
  limit: limitValue ? Number(limitValue) : null,
  retryFailed: hasFlag("retry-failed"),
  skipComplete: !hasFlag("no-skip-complete"),
  searchAttempts: searchAttemptsValue ? Number(searchAttemptsValue) : undefined,
  searchDelayMs: searchDelayValue ? Number(searchDelayValue) : undefined,
});

const counts = rows.reduce((acc, row) => {
  acc[row.processing_status] = (acc[row.processing_status] || 0) + 1;
  return acc;
}, {});
console.log(
  `Wrote ${rows.length} VideoDB evidence rows to ${output} (${counts.complete || 0} complete, ${counts.partial || 0} partial, ${counts.failed || 0} failed)`,
);
