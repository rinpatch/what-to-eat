import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  COMPLETE,
  FAILED,
  PARTIAL,
  buildVideoDbCache,
  processPost,
  readPublicVideoEvidence,
  selectBestClip,
} from "../scripts/pipeline/videodb-cache.mjs";

const post = {
  post_id: "post-1",
  video_url: "https://example.com/food.mp4",
  caption: "Worth the queue",
  creator_handle: "@tester",
  posted_at: "2026-06-13T10:00:00+08:00",
  engagement: { likes: 10, comments: 2, views: 100 },
  source_url: "https://example.com/post-1",
};

class FakeAdapter {
  constructor(options = {}) {
    this.options = options;
    this.uploads = 0;
    this.searches = 0;
  }

  async uploadVideo(url) {
    this.uploads += 1;
    if (this.options.uploadError) throw new Error("bad source url");
    return { id: "vdb-1", url, streamUrl: "https://stream.example/hls.m3u8" };
  }

  async indexFoodAudio() {
    if (this.options.audioError) throw new Error("audio unavailable");
  }

  async indexFoodVisuals() {
    if (this.options.visualError) throw new Error("visual unavailable");
  }

  async searchFoodMoments() {
    this.searches += 1;
    if (this.options.emptyUntil && this.searches < this.options.emptyUntil) {
      return { transcriptSnippets: [], visualSnippets: [] };
    }
    return this.options.moments || {
      transcriptSnippets: [
        { start: 10, end: 18, text: "this is worth the queue", score: 0.9, source: "spoken_word" },
      ],
      visualSnippets: [
        { start: 14, end: 22, text: "dish reveal and menu price", score: 0.8, source: "scene" },
      ],
    };
  }
}

test("processPost writes stable complete evidence rows", async () => {
  const row = await processPost(post, { adapter: new FakeAdapter(), searchDelayMs: 0 });
  assert.equal(row.processing_status, COMPLETE);
  assert.equal(row.post_id, "post-1");
  assert.equal(row.stream_url, "https://stream.example/hls.m3u8");
  assert.equal(row.best_clip.reason, "overlapping spoken and visual food evidence");
  assert.deepEqual(Object.keys(row).sort(), [
    "best_clip",
    "errors",
    "post_id",
    "processing_status",
    "quote_candidates",
    "stream_url",
    "tokenrouter_input",
    "transcript_snippets",
    "video_id",
    "video_url",
    "visual_snippets",
  ].sort());
});

test("partial rows preserve evidence when one index fails", async () => {
  const row = await processPost(post, { adapter: new FakeAdapter({ audioError: true }), searchDelayMs: 0 });
  assert.equal(row.processing_status, PARTIAL);
  assert.match(row.errors.join("\n"), /audio index failed/);
  assert.ok(row.best_clip);
});

test("empty results become failed rows with stable empty arrays", async () => {
  const row = await processPost(post, {
    adapter: new FakeAdapter({ moments: { transcriptSnippets: [], visualSnippets: [] } }),
    searchDelayMs: 0,
  });
  assert.equal(row.processing_status, FAILED);
  assert.deepEqual(row.quote_candidates, []);
  assert.deepEqual(row.transcript_snippets, []);
  assert.deepEqual(row.visual_snippets, []);
});

test("best clip selection falls back visual before transcript", () => {
  const visualOnly = selectBestClip([], [{ start: 5, end: 7, text: "food", score: 0.5 }]);
  assert.equal(visualOnly.reason, "visual food evidence");
  assert.equal(visualOnly.end - visualOnly.start, 6);

  const transcriptOnly = selectBestClip([{ start: 20, end: 35, text: "worth", score: 0.7 }], []);
  assert.equal(transcriptOnly.reason, "spoken creator reaction");
});

test("cache builder skips complete rows and retries failed rows only when requested", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vdb-cache-"));
  const input = join(dir, "seed.json");
  const output = join(dir, "evidence.json");
  await writeFile(input, JSON.stringify([post]));
  await writeFile(output, JSON.stringify([{ post_id: "post-1", processing_status: COMPLETE }]));

  const skippedAdapter = new FakeAdapter();
  await buildVideoDbCache({ input, output, adapter: skippedAdapter, searchDelayMs: 0 });
  assert.equal(skippedAdapter.uploads, 0);

  await writeFile(output, JSON.stringify([{ post_id: "post-1", processing_status: FAILED }]));
  const notRetriedAdapter = new FakeAdapter();
  await buildVideoDbCache({ input, output, adapter: notRetriedAdapter, searchDelayMs: 0 });
  assert.equal(notRetriedAdapter.uploads, 0);

  const retriedAdapter = new FakeAdapter();
  await buildVideoDbCache({ input, output, adapter: retriedAdapter, retryFailed: true, searchDelayMs: 0 });
  assert.equal(retriedAdapter.uploads, 1);
});

test("public cache reader does not need VideoDB and filters failed rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vdb-public-"));
  const output = join(dir, "evidence.json");
  await writeFile(output, JSON.stringify([
    { post_id: "ok", processing_status: COMPLETE, quote_candidates: null },
    { post_id: "bad", processing_status: FAILED },
  ]));
  const rows = await readPublicVideoEvidence(output);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].post_id, "ok");
  assert.deepEqual(rows[0].quote_candidates, []);
});

test("search retry handles VideoDB async indexing gap", async () => {
  const adapter = new FakeAdapter({ emptyUntil: 2 });
  const row = await processPost(post, { adapter, searchAttempts: 2, searchDelayMs: 0 });
  assert.equal(row.processing_status, COMPLETE);
  assert.equal(adapter.searches, 2);
});
