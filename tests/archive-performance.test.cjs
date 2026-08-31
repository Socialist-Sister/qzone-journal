const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ArchiveStore, atomicWriteJson } = require("../desktop/archive/store.cjs");

const ENTRY_COUNT = 10_000;
const MEDIA_PER_ENTRY = 5;

test("10k entries and 50k media references remain indexable and paginated", { timeout: 120_000 }, async (context) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-journal-stress-"));
  context.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const entriesDirectory = path.join(rootPath, "records", "entries");
  await fs.mkdir(entriesDirectory, { recursive: true });
  const startedAt = Date.now();

  for (let offset = 0; offset < ENTRY_COUNT; offset += 100) {
    await Promise.all(Array.from({ length: Math.min(100, ENTRY_COUNT - offset) }, (_, localIndex) => {
      const index = offset + localIndex;
      return atomicWriteJson(path.join(entriesDirectory, `entry-${String(index).padStart(5, "0")}.json`), {
        schemaVersion: 1,
        sourceId: `stress-${index}`,
        type: "post",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) - index * 1000).toISOString(),
        title: null,
        text: `压力测试内容 target-${index}`,
        media: Array.from({ length: MEDIA_PER_ENTRY }, (_, mediaIndex) => ({
          sourceUrl: `https://example.invalid/${index}/${mediaIndex}.jpg`,
          localPath: `media/files/${index}-${mediaIndex}.jpg`,
          size: 128,
        })),
        comments: [{ authorName: "测试作者", text: "可见评论" }],
        likes: [{ name: "可见点赞者" }],
        metrics: { commentCount: 2, likeCount: 3 },
      });
    }));
  }

  const store = new ArchiveStore(rootPath);
  const firstPage = await store.readEntriesPage({ limit: 100 });
  const searchPage = await store.readEntriesPage({ query: "target-9999", limit: 10 });
  assert.equal(firstPage.entries.length, 100);
  assert.equal(firstPage.page.total, ENTRY_COUNT);
  assert.equal(firstPage.page.hasMore, true);
  assert.equal(firstPage.stats.media, ENTRY_COUNT * MEDIA_PER_ENTRY);
  assert.equal(firstPage.stats.comments, ENTRY_COUNT * 2);
  assert.equal(firstPage.stats.visibleComments, ENTRY_COUNT);
  assert.deepEqual(searchPage.entries.map((entry) => entry.sourceId), ["stress-9999"]);
  context.diagnostic(`fixture + index + queries: ${Date.now() - startedAt} ms`);
});
