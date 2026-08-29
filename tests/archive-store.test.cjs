const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ArchiveStore, atomicWriteJson, readJson } = require("../desktop/archive/store.cjs");
const { ARCHIVE_SCHEMA_VERSION, sanitizeCollectionOptions } = require("../desktop/archive/schema.cjs");

test("collection options are allow-listed and deduplicated", () => {
  assert.deepEqual(sanitizeCollectionOptions({ items: ["posts", "comments", "posts", "unknown"] }), {
    items: ["posts", "comments"],
    includeComments: true,
    includeLikes: false,
    includeMedia: true,
  });
  assert.throws(() => sanitizeCollectionOptions({ items: ["unknown"] }), /至少选择一项/);
});

test("archive store creates a versioned resumable archive and preserves media index", async (context) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-journal-archive-"));
  context.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const store = new ArchiveStore(rootPath);
  const options = sanitizeCollectionOptions({ items: ["posts", "albums", "comments", "likes"] });

  await store.initialize({ ownerUin: "12345678", jobId: "job-1", options });
  const { filePath } = await store.writeEntry({
    sourceId: "post-1",
    type: "post",
    createdAt: "2025-05-03T08:00:00.000Z",
    text: "一条没有标题的说说",
    media: [{ sourceUrl: "https://example.invalid/photo.jpg" }],
  });
  await store.writeCheckpoint({ jobId: "job-1", phase: "posts", cursors: { posts: "cursor-1" } });
  await atomicWriteJson(path.join(rootPath, "media", "index.json"), {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    items: { photo1: { relativePath: "media/files/photo1.jpg" } },
  });
  await store.complete({ jobId: "job-1", status: "ready_for_collection", counts: { entries: 1, media: 1, comments: 0, likes: 0 } });

  const manifest = await readJson(path.join(rootPath, "manifest.json"));
  const entry = await readJson(filePath);
  assert.equal(manifest.schemaVersion, ARCHIVE_SCHEMA_VERSION);
  assert.equal(manifest.source.ownerUin, "12345678");
  assert.equal(manifest.collection.status, "ready_for_collection");
  assert.equal(entry.title, null);
  assert.equal(entry.text, "一条没有标题的说说");

  await store.initialize({ ownerUin: "12345678", jobId: "job-2", options });
  const mediaIndex = await readJson(path.join(rootPath, "media", "index.json"));
  assert.equal(mediaIndex.items.photo1.relativePath, "media/files/photo1.jpg");
});

test("parser migration quarantines legacy normalized entries and restarts pagination", async (context) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-journal-migration-"));
  context.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const store = new ArchiveStore(rootPath);
  const options = sanitizeCollectionOptions({ items: ["posts"] });
  await store.initialize({ ownerUin: "12345678", jobId: "legacy-job", options });
  await store.writeEntry({ sourceId: "legacy-post", type: "post", createdAt: "2026-08-28T00:00:00.000Z", text: "\\t旧解析正文" });
  await store.writeCheckpoint({ jobId: "legacy-job", phase: "failed", cursors: { posts: "offset=10" }, counts: { entries: 1 } });
  const manifestPath = path.join(rootPath, "manifest.json");
  const manifest = await readJson(manifestPath);
  delete manifest.collection.parserVersion;
  await atomicWriteJson(manifestPath, manifest);

  await store.initialize({ ownerUin: "12345678", jobId: "new-job", options });
  const checkpoint = await store.readCheckpoint();
  const entries = await store.readEntries();
  const migration = await readJson(path.join(rootPath, "diagnostics", "parser-migration.json"));
  assert.equal(entries.length, 0);
  assert.deepEqual(checkpoint.cursors, {});
  assert.equal(migration.quarantinedEntries, 1);
});
