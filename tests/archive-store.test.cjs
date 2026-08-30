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
  assert.ok(Number.isFinite(Date.parse(manifest.collection.lastCompletedAt)));
  assert.equal(entry.title, null);
  assert.equal(entry.text, "一条没有标题的说说");

  await store.initialize({ ownerUin: "12345678", jobId: "job-2", options });
  const mediaIndex = await readJson(path.join(rootPath, "media", "index.json"));
  assert.equal(mediaIndex.items.photo1.relativePath, "media/files/photo1.jpg");
});

test("parser migration keeps legacy entries visible until collection starts and restores them on failure", async (context) => {
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

  const initialization = await store.initialize({ ownerUin: "12345678", jobId: "new-job", options });
  assert.equal(initialization.migrationRequired, true);
  assert.equal((await store.readEntries()).length, 1);

  const transaction = await store.beginParserMigration({ jobId: "new-job" });
  assert.equal((await store.readEntries()).length, 0);
  await store.writeEntry({ sourceId: "legacy-post", type: "post", createdAt: "2026-08-28T00:00:00.000Z", text: "新解析正文" });
  const restored = await store.rollbackParserMigration(transaction);
  const entries = await store.readEntries();
  const state = await readJson(path.join(rootPath, "state", "parser-migration-transaction.json"));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, "\\t旧解析正文");
  assert.deepEqual(restored.cursors, {});
  assert.equal(state.phase, "rolled_back");
  assert.equal((await fs.readdir(path.join(rootPath, ...transaction.quarantineRelativePath.split("/"), "failed-new"))).length, 1);
});

test("interrupted parser migration is rolled back automatically on the next initialization", async (context) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-journal-migration-recovery-"));
  context.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const options = sanitizeCollectionOptions({ items: ["posts"] });
  const store = new ArchiveStore(rootPath);
  await store.initialize({ ownerUin: "12345678", jobId: "legacy-job", options });
  await store.writeEntry({ sourceId: "legacy-post", type: "post", createdAt: "2026-08-28T00:00:00.000Z", text: "旧档案仍可恢复" });
  const manifestPath = path.join(rootPath, "manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.collection.parserVersion = 1;
  await atomicWriteJson(manifestPath, manifest);
  await store.initialize({ ownerUin: "12345678", jobId: "migration-job", options });
  await store.beginParserMigration({ jobId: "migration-job" });
  await store.writeEntry({ sourceId: "new-post", type: "post", createdAt: "2026-08-29T00:00:00.000Z", text: "未完成的新档案" });

  const restartedStore = new ArchiveStore(rootPath);
  const initialization = await restartedStore.initialize({ ownerUin: "12345678", jobId: "restarted-job", options });
  const entries = await restartedStore.readEntries();
  const state = await readJson(path.join(rootPath, "state", "parser-migration-transaction.json"));
  assert.equal(initialization.migrationRequired, true);
  assert.deepEqual(entries.map((entry) => entry.text), ["旧档案仍可恢复"]);
  assert.equal(state.phase, "rolled_back");
});

test("successful parser migration keeps the old records in diagnostics and commits the new parser version", async (context) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-journal-migration-commit-"));
  context.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const options = sanitizeCollectionOptions({ items: ["posts"] });
  const store = new ArchiveStore(rootPath);
  await store.initialize({ ownerUin: "12345678", jobId: "legacy-job", options });
  await store.writeEntry({ sourceId: "legacy-post", type: "post", createdAt: "2026-08-28T00:00:00.000Z", text: "旧解析正文" });
  const manifestPath = path.join(rootPath, "manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.collection.parserVersion = 1;
  await atomicWriteJson(manifestPath, manifest);
  await store.initialize({ ownerUin: "12345678", jobId: "migration-job", options });
  const transaction = await store.beginParserMigration({ jobId: "migration-job" });
  await store.writeEntry({ sourceId: "legacy-post", type: "post", createdAt: "2026-08-28T00:00:00.000Z", text: "新解析正文" });
  const counts = await store.summarize();
  await store.complete({ jobId: "migration-job", status: "complete", counts });
  await store.commitParserMigration(transaction);

  const committedManifest = await readJson(manifestPath);
  const entries = await store.readEntries();
  const previousDirectory = path.join(rootPath, ...transaction.quarantineRelativePath.split("/"), "previous");
  assert.equal(committedManifest.collection.parserVersion, 3);
  assert.equal(entries[0].text, "新解析正文");
  assert.equal((await fs.readdir(previousDirectory)).length, 1);
});
