const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, utilityProcess } = require("electron");
const { analyzeQzoneCookies, publicSessionStatus, selectQzoneCookie } = require("../desktop/qzone-session.cjs");

async function run() {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-journal-collector-"));
  const workerPath = path.join(__dirname, "..", "desktop", "collector", "worker.cjs");
  const child = utilityProcess.fork(workerPath, [], {
    partition: `persist:qzone-journal-test-${Date.now()}`,
    stdio: "ignore",
    serviceName: "QZone Journal Collector Test",
  });

  try {
    const terminal = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("独立采集进程测试超时")), 12000);
      const progress = [];
      child.on("message", (message) => {
        if (message?.type === "progress") progress.push(message);
        if (["complete", "error", "cancelled"].includes(message?.type)) {
          clearTimeout(timeout);
          resolve({ message, progress });
        }
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.postMessage({
        type: "start",
        job: {
          jobId: "collector-smoke",
          ownerUin: "12345678",
          archiveRoot: rootPath,
          options: { items: ["posts", "albums", "comments", "likes"], includeComments: true, includeLikes: true, includeMedia: true },
          testMode: true,
          testEntries: [{ sourceId: "test-post-1", type: "post", createdAt: "2026-08-29T01:00:00.000Z", title: null, text: "独立采集进程测试", media: [], comments: [{ name: "测试用户", text: "评论" }], likes: [{ name: "测试用户" }], metrics: { commentCount: 1, likeCount: 1 }, sourceMeta: { adapter: "test" } }],
        },
      });
    });

    assert.equal(terminal.message.type, "complete");
    assert.equal(terminal.message.phase, "collection_complete");
    assert.ok(terminal.progress.length >= 3);
    const manifest = JSON.parse(await fs.readFile(path.join(rootPath, "manifest.json"), "utf8"));
    const checkpoint = JSON.parse(await fs.readFile(path.join(rootPath, "state", "checkpoint.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.collection.status, "complete");
    assert.equal(manifest.collection.counts.entries, 1);
    assert.equal(checkpoint.phase, "complete");

    const cookieStatus = analyzeQzoneCookies([
      { name: "uin", value: "o12345678", domain: ".qq.com" },
      { name: "p_skey", value: "secret", domain: ".qzone.qq.com" },
    ]);
    assert.equal(cookieStatus.authenticated, true);
    assert.equal(cookieStatus.uin, "12345678");
    assert.equal("uin" in publicSessionStatus(cookieStatus), false);
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
