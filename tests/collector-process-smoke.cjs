const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, utilityProcess } = require("electron");
const { analyzeQzoneCookies, publicSessionStatus, selectQzoneCookie } = require("../desktop/qzone-session.cjs");
const { fetchMoodPage } = require("../desktop/collector/qzone-adapter.cjs");

async function run() {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-journal-collector-"));
  const workerPath = path.join(__dirname, "..", "desktop", "collector", "worker.cjs");
  const child = utilityProcess.fork(workerPath, [], {
    partition: `persist:qzone-journal-test-${Date.now()}`,
    stdio: "ignore",
    serviceName: "QZone Journal Collector Test",
  });

  try {
    const staleCursorCalls = [];
    const recoveredPage = await fetchMoodPage({
      uin: "12345678",
      gTk: 123,
      cursor: "40",
      adapter: "mood_list",
      resetStaleCursor: true,
    }, { fetch: async (url) => {
      const offset = new URL(url).searchParams.get("pos");
      staleCursorCalls.push(offset);
      if (offset !== "0") {
        const error = new Error("stale cursor");
        error.code = -10001;
        throw error;
      }
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => "application/json" },
        text: async () => '_preloadCallback({"code":0,"total":0,"msglist":[]});',
      };
    } });
    assert.deepEqual(staleCursorCalls, ["40", "0"]);
    assert.equal(recoveredPage.resumeCursorReset, true);
    assert.equal(recoveredPage.diagnostic.rejectedCursorCode, "-10001");

    let freshRequestCalls = 0;
    await assert.rejects(() => fetchMoodPage({
      uin: "12345678",
      gTk: 123,
      cursor: "",
      adapter: "mood_list",
      resetStaleCursor: true,
    }, { fetch: async () => {
      freshRequestCalls += 1;
      const error = new Error("expired session");
      error.code = -10001;
      throw error;
    } }), /expired session/);
    assert.equal(freshRequestCalls, 1);

    const runJob = (job) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("独立采集进程测试超时")), 12000);
      const progress = [];
      const onMessage = (message) => {
        if (message?.type === "progress") progress.push(message);
        if (["complete", "error", "cancelled"].includes(message?.type)) {
          clearTimeout(timeout);
          child.off("message", onMessage);
          resolve({ message, progress });
        }
      };
      const onError = (error) => {
        clearTimeout(timeout);
        child.off("message", onMessage);
        reject(error);
      };
      child.once("error", onError);
      child.on("message", onMessage);
      child.postMessage({
        type: "start",
        job,
      });
    });
    const baseJob = {
      ownerUin: "12345678",
      archiveRoot: rootPath,
      options: { items: ["posts", "albums", "comments", "likes"], includeComments: true, includeLikes: true, includeMedia: true },
      testMode: true,
      testEntries: [{ sourceId: "test-post-1", type: "post", createdAt: "2026-08-29T01:00:00.000Z", title: null, text: "独立采集进程测试", media: [], comments: [{ name: "测试用户", text: "评论" }], likes: [{ name: "测试用户" }], metrics: { commentCount: 1, likeCount: 2 }, sourceMeta: { adapter: "test", parserVersion: 7, likeCountReported: true, commentCountReported: true } }],
      testLikeDetails: {
        "test-post-1": { likes: [{ name: "测试用户" }, { name: "另一位用户" }], total: 2, diagnostics: [] },
      },
    };
    const terminal = await runJob({ ...baseJob, jobId: "collector-smoke" });

    assert.equal(terminal.message.type, "complete");
    assert.equal(terminal.message.phase, "collection_complete");
    assert.deepEqual(terminal.message.adapterHealth, {
      status: "healthy",
      adapter: "mood_list",
      message: "QQ 说说分类接口工作正常",
    });
    assert.deepEqual(terminal.message.changes, { added: 1, updated: 0, skipped: 0 });
    assert.ok(terminal.progress.length >= 3);
    const manifest = JSON.parse(await fs.readFile(path.join(rootPath, "manifest.json"), "utf8"));
    const checkpoint = JSON.parse(await fs.readFile(path.join(rootPath, "state", "checkpoint.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.collection.status, "complete");
    assert.equal(manifest.collection.counts.entries, 1);
    assert.equal(manifest.collection.counts.likes, 2);
    assert.equal(manifest.collection.counts.visibleLikes, 2);
    assert.equal(checkpoint.phase, "complete");
    assert.equal(terminal.progress.some((item) => item.phase === "collecting_likes"), true);

    const incremental = await runJob({ ...baseJob, jobId: "collector-incremental-smoke" });
    assert.equal(incremental.message.type, "complete");
    assert.equal(incremental.message.mode, "incremental");
    assert.deepEqual(incremental.message.changes, { added: 0, updated: 0, skipped: 1 });

    const interactionPartial = await runJob({
      ...baseJob,
      jobId: "collector-like-partial-smoke",
      testEntries: [{ ...baseJob.testEntries[0], sourceId: "test-like-partial", text: "点赞补充限流仍需保留正文", likes: [], metrics: { commentCount: 1, likeCount: 1 } }],
      testLikeErrorCode: "QZONE_INTERACTION_RATE_LIMITED",
    });
    assert.equal(interactionPartial.message.type, "complete");
    assert.equal(interactionPartial.message.phase, "collection_partial");
    assert.equal(interactionPartial.message.partialReason, "likes");
    assert.equal(interactionPartial.message.counts.entries, 2);
    const interactionCheckpoint = JSON.parse(await fs.readFile(path.join(rootPath, "state", "checkpoint.json"), "utf8"));
    assert.equal(interactionCheckpoint.phase, "partial");
    assert.equal(interactionCheckpoint.cursors.likes > 0, true);

    const partial = await runJob({
      ...baseJob,
      jobId: "collector-partial-smoke",
      testEntries: [{ ...baseJob.testEntries[0], sourceId: "test-post-2", text: "部分分页仍需保留" }],
      testAuthAfterPage: 2,
    });
    assert.equal(partial.message.type, "complete");
    assert.equal(partial.message.phase, "collection_partial");
    assert.equal(partial.message.mode, "partial");
    assert.equal(partial.message.truncated, true);
    assert.equal(partial.message.adapterHealth.status, "partial");
    assert.equal(partial.message.counts.entries, 3);
    const partialCheckpoint = JSON.parse(await fs.readFile(path.join(rootPath, "state", "checkpoint.json"), "utf8"));
    assert.equal(partialCheckpoint.phase, "partial");
    assert.equal(partialCheckpoint.counts.entries, 3);

    const cookieStatus = analyzeQzoneCookies([
      { name: "uin", value: "o12345678", domain: ".qq.com" },
      { name: "p_skey", value: "secret", domain: ".qzone.qq.com" },
    ]);
    assert.equal(cookieStatus.authenticated, true);
    assert.equal(cookieStatus.uin, "12345678");
    assert.equal(publicSessionStatus(cookieStatus).uin, "12345678");
    assert.match(publicSessionStatus(cookieStatus).avatarUrl, /dst_uin=12345678/);
    const mediaOnlyStatus = analyzeQzoneCookies([
      { name: "media_p_uin", value: "o12345678", domain: ".qq.com" },
      { name: "media_p_skey", value: "temporary", domain: ".qq.com" },
    ]);
    assert.equal(mediaOnlyStatus.authenticated, false);
    const genericSkeyOnlyStatus = analyzeQzoneCookies([
      { name: "uin", value: "o12345678", domain: ".qq.com" },
      { name: "skey", value: "base-login-only", domain: ".qq.com" },
    ]);
    assert.equal(genericSkeyOnlyStatus.authenticated, false);
    const preferredSessionKey = selectQzoneCookie([
      { name: "p_skey", value: "generic", domain: ".qq.com" },
      { name: "p_skey", value: "qzone-specific", domain: ".qzone.qq.com" },
    ], "p_skey");
    assert.equal(preferredSessionKey.value, "qzone-specific");
    process.stdout.write(`Collector process smoke passed: ${rootPath}\n`);
  } finally {
    child.kill();
    await fs.rm(rootPath, { recursive: true, force: true });
  }
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
