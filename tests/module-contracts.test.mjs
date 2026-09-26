import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { archiveMedia } from "../src/domain/media.js";
const require = createRequire(import.meta.url);
const { ArchiveStore } = require("../desktop/archive/store.cjs");
const { toRendererArchiveEntry } = require("../desktop/archive/renderer-entry.cjs");
const { publicCollectorEvent } = require("../desktop/contracts/collector-events.cjs");

test("stored mixed media keeps its order across paging, IPC mapping and frontend fallback", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-contract-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ArchiveStore(root);
  await store.initialize({ ownerUin: "12345678", jobId: "contract", options: { items: ["posts"] } });
  const kinds = ["image", "image", "image", "video", "image", "video", "video", "image", "image"];
  await store.writeEntry({ sourceId: "mixed", type: "post", createdAt: "2025-10-04T14:35:00.000Z",
    text: "@{uin:87654321,nick:朋友,who:1,auto:1}",
    media: kinds.map((kind, index) => ({ kind, localPath: index === 5 ? "" : `media/files/${index}.${kind === "video" ? "mp4" : "jpg"}`,
      posterLocalPath: kind === "video" ? `media/files/${index}-poster.jpg` : "" })),
    comments: [{ authorName: "朋友", text: "评论", uin: "87654321" }], likes: [] });
  const page = await store.readEntriesPage({ limit: 1 });
  const entry = toRendererArchiveEntry(page.entries[0], root);
  assert.deepEqual(archiveMedia(entry).map((item) => item.kind), kinds);
  assert.equal(entry.media[5].available, false);
  assert.ok(entry.media[5].poster.startsWith("file:"));
  assert.equal(entry.images.length, 6);
  assert.equal(entry.videos.length, 3);
  assert.equal(entry.text, "@朋友");
  assert.equal(JSON.stringify(entry).includes("87654321"), false);
  // Legacy aliases must never override the canonical ordered list, even when empty.
  assert.strictEqual(archiveMedia({ ...entry, images: ["wrong.jpg"] }), entry.media);
  assert.deepEqual(archiveMedia({ media: [], images: ["wrong.jpg"] }), []);
});

test("legacy frontend payloads still work without an ordered media array", () => {
  assert.deepEqual(archiveMedia({ images: ["old.jpg"], videos: [{ src: "old.mp4" }] }),
    [{ kind: "image", src: "old.jpg" }, { kind: "video", src: "old.mp4" }]);
  assert.deepEqual(archiveMedia({ images: {}, videos: null }), []);
});

test("renderer mapping excludes paths outside the selected archive and keeps poster-only videos", () => {
  const root = path.resolve(os.tmpdir(), "archive-contract");
  const entry = toRendererArchiveEntry({ sourceId: "unsafe", media: [
    { kind: "image", localPath: "../../secret.jpg" },
    { kind: "video", localPath: "../../secret.mp4", posterLocalPath: "media/poster.jpg" },
  ] }, root);
  assert.equal(entry.media.length, 1);
  assert.equal(entry.media[0].src, "");
  assert.equal(entry.media[0].available, false);
  assert.ok(entry.media[0].poster.startsWith("file:"));
});

test("collector events expose only bounded counters and never trust worker paths", () => {
  const event = publicCollectorEvent({ type: "complete", jobId: "job", archivePath: "C:/private", cookie: "secret",
    counts: { entries: 2, media: -1, mediaBytes: Infinity, comments: 3.9, rawResponse: "private", uin: "12345678" },
    changes: { added: Infinity, updated: -2, skipped: 4 }, mode: "partial", partialReason: "likes", truncated: true });
  assert.equal(event.archivePath, "");
  assert.deepEqual(event.counts, { entries: 2, media: 0, mediaBytes: 0, comments: 3, likes: 0, visibleComments: 0, visibleLikes: 0 });
  assert.deepEqual(event.changes, { added: 0, updated: 0, skipped: 4 });
  assert.equal(event.cookie, undefined);
  assert.equal(event.mode, "partial");
  assert.equal(event.partialReason, "likes");
  assert.equal(event.truncated, true);
  assert.equal(publicCollectorEvent(null).type, "error");
  assert.equal(publicCollectorEvent({ type: "progress", mode: "partial" }).mode, undefined);
});
