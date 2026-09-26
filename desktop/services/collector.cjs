const { utilityProcess } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { assertMinimumFreeSpace } = require("../storage-safety.cjs");
const { sanitizeCollectionOptions } = require("../archive/schema.cjs");
const { ArchiveStore } = require("../archive/store.cjs");
const { clearQzoneCookies, getQzoneRequestContext, getQzoneSession, updateQzoneAccountProfile } = require("../qzone-session.cjs");
const { publicCollectorEvent } = require("../contracts/collector-events.cjs");
const { defaultArchiveRoot, rememberLatestArchive, readArchiveIdentity } = require("./archives.cjs");

const collectorJobs = new Map();
let collectorStarting = false;
async function startCollectorJob(sender, input) {
  if (collectorStarting || collectorJobs.size) throw new Error("已有采集任务正在运行");
  collectorStarting = true;
  try { return await launchCollectorJob(sender, input); }
  finally { collectorStarting = false; }
}

async function launchCollectorJob(sender, input) {
  const sessionStatus = await getQzoneRequestContext();
  const options = sanitizeCollectionOptions(input);
  const jobId = randomUUID();
  const archiveRoot = await defaultArchiveRoot(sessionStatus.uin);
  await fs.mkdir(archiveRoot, { recursive: true });
  await assertMinimumFreeSpace(archiveRoot);
  const child = utilityProcess.fork(path.join(__dirname, "..", "collector", "worker.cjs"), [], {
    session: getQzoneSession(),
    stdio: "ignore",
    serviceName: "QZone Archive Collector",
  });
  const jobState = { child, sender, terminal: false, archiveRoot };
  collectorJobs.set(jobId, jobState);

  let finishPromise = null;
  const finish = () => {
    if (finishPromise) return finishPromise;
    jobState.terminal = true;
    child.kill();
    finishPromise = clearQzoneCookies(sessionStatus.accountId).catch(() => undefined)
      .finally(() => collectorJobs.delete(jobId));
    return finishPromise;
  };

  child.on("message", (message) => {
    void (async () => {
      const event = publicCollectorEvent(message);
      if (["error", "cancelled"].includes(event.type)) {
        // Trust the archive on disk over possibly stale worker counters. This
        // also recovers archives written by older builds before indexing.
        event.counts = await new ArchiveStore(archiveRoot).summarize();
      }
      const terminalWithArchive = event.type === "complete"
        || (["error", "cancelled"].includes(event.type) && Number(event.counts?.entries || 0) > 0);
      if (terminalWithArchive) {
        // Use the main-process-selected path; never trust a path sent by the worker.
        event.archivePath = archiveRoot;
        const archiveIdentity = await readArchiveIdentity(archiveRoot);
        const profile = await updateQzoneAccountProfile(sessionStatus.accountId, {
          uin: sessionStatus.uin || archiveIdentity.uin,
          nickname: sessionStatus.nickname || archiveIdentity.nickname,
        });
        await rememberLatestArchive(archiveRoot, profile, sessionStatus.accountId);
      }
      if (["complete", "error", "cancelled"].includes(event.type)) await finish();
      if (!sender.isDestroyed()) sender.send("desktop:qzone:collector-event", event);
    })().catch(() => {
      if (!sender.isDestroyed()) sender.send("desktop:qzone:collector-event", { type: "error", jobId, progress: 0, phase: "archive_index", message: "采集完成，但无法保存本地档案索引" });
      void finish();
    });
  });
  child.on("error", () => {
    void finish();
    if (!sender.isDestroyed()) sender.send("desktop:qzone:collector-event", { type: "error", jobId, progress: 0, phase: "process_error", message: "独立采集进程发生错误" });
  });
  child.on("exit", (code) => {
    if (!jobState.terminal && !sender.isDestroyed()) {
      sender.send("desktop:qzone:collector-event", { type: "error", jobId, progress: 0, phase: "process_exit", message: `采集进程意外退出（代码 ${code}）` });
    }
    void finish();
  });
  child.postMessage({
    type: "start",
    job: { jobId, ownerUin: sessionStatus.uin, gTk: sessionStatus.gTk, archiveRoot, options },
  });
  return {
    jobId,
    archivePath: archiveRoot,
    uin: sessionStatus.uin,
    nickname: sessionStatus.nickname,
    avatarUrl: sessionStatus.avatarUrl,
    accountLabel: sessionStatus.accountLabel,
  };
}

function isCollecting() {
  return collectorStarting || collectorJobs.size > 0;
}

function cancelCollection(jobId) {
  const job = collectorJobs.get(String(jobId || ""));
  if (!job || job.terminal) return { cancelled: false };
  job.child.postMessage({ type: "cancel", jobId: String(jobId) });
  return { cancelled: true };
}

function stopCollectors() {
  for (const job of collectorJobs.values()) job.child.kill();
  collectorJobs.clear();
}

module.exports = { startCollectorJob, launchCollectorJob, isCollecting, cancelCollection, stopCollectors };
