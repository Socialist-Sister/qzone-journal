const { ArchiveStore } = require("../archive/store.cjs");
const { FEEDS3_PAGE_SIZE, abortableDelay, createCollectionPlan, downloadMedia, fetchMoodPage, probeSession } = require("./qzone-adapter.cjs");
const { isAuthenticationFailure } = require("./qzone-parser.cjs");

const parentPort = process.parentPort;
if (!parentPort) throw new Error("采集器必须由 Electron Utility Process 启动");

let activeJob = null;
let activeAbortController = null;

function emit(type, payload = {}) {
  parentPort.postMessage({ type, ...payload });
}

function throwIfCancelled() {
  if (!activeAbortController?.signal.aborted) return;
  const error = new Error("采集任务已取消");
  error.name = "AbortError";
  throw error;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function run(job) {
  if (activeJob) throw new Error("采集进程中已有任务正在运行");
  activeJob = job;
  activeAbortController = new AbortController();
  const store = new ArchiveStore(job.archiveRoot);
  let counts = { entries: 0, media: 0, mediaBytes: 0, comments: 0, likes: 0 };
  const mediaFailures = [];
  const pageDiagnostics = [];
  let activeCursors = {};
  let parserMigration = null;
  const changes = { added: 0, updated: 0, skipped: 0 };
  let incrementalMode = false;
  let stoppedAtKnownPage = false;
  let paginationTruncated = null;

  try {
    emit("progress", { jobId: job.jobId, progress: 5, phase: "initializing", message: "正在建立本地归档目录…" });
    const previousCheckpoint = await store.readCheckpoint();
    const initialization = await store.initialize({ ownerUin: job.ownerUin, jobId: job.jobId, options: job.options });
    counts = await store.summarize();
    const canResume = !initialization.migrationRequired && ["collecting_posts", "cancelled", "failed", "partial"].includes(previousCheckpoint?.phase);
    let resumeCursor = canResume ? String(previousCheckpoint?.cursors?.posts || "") : "";
    let resumeScope = canResume && Number(previousCheckpoint?.cursors?.postScope) === 0 ? 0 : 1;
    const lastFullScanAt = Date.parse(String(initialization.manifest.collection?.lastFullScanAt || ""));
    const fullScanDue = !Number.isFinite(lastFullScanAt) || Date.now() - lastFullScanAt >= 30 * 24 * 60 * 60 * 1000;
    incrementalMode = counts.entries > 0 && !canResume && !initialization.migrationRequired && !fullScanDue;
    activeCursors = { posts: resumeCursor, postScope: resumeScope };
    throwIfCancelled();
    await store.writeCheckpoint({ jobId: job.jobId, phase: "session_check", cursors: activeCursors, counts });

    emit("progress", { jobId: job.jobId, progress: 24, phase: "session_check", message: "正在确认 QQ 登录会话…" });
    const sessionProbe = job.testMode
      ? { ok: true, status: 200, finalHost: "user.qzone.qq.com", checkedAt: new Date().toISOString(), testMode: true }
      : await probeSession({ uin: job.ownerUin, signal: activeAbortController.signal });
    throwIfCancelled();
    await store.writeDiagnostic("session-check", sessionProbe);

    emit("progress", { jobId: job.jobId, progress: 30, phase: "planning", message: "正在准备增量采集计划…" });
    if (initialization.migrationRequired) {
      parserMigration = await store.beginParserMigration({ jobId: job.jobId });
      counts = await store.summarize();
      incrementalMode = false;
      resumeCursor = "";
      resumeScope = 1;
      activeCursors = { posts: "", postScope: 1 };
    }
    const plan = createCollectionPlan(job.options);
    throwIfCancelled();
    await store.writeDiagnostic("collection-plan", { items: plan });
    let cursor = resumeCursor;
    let feedScope = resumeScope;
    activeCursors = { posts: cursor, postScope: feedScope };
    await store.writeCheckpoint({ jobId: job.jobId, phase: "adapter_ready", cursors: activeCursors, counts });

    const needsPostStream = job.options.items.some((item) => ["posts", "comments", "likes"].includes(item));
    if (needsPostStream) {
      let pageNumber = 0;
      let processedEntries = 0;
      let hasMore = true;
      let usedScopeFallback = false;
      const seenCursors = new Set();
      while (hasMore && pageNumber < 500) {
        throwIfCancelled();
        pageNumber += 1;
        let page;
        let pageError = null;
        try {
          if (job.testMode && Number(job.testAuthAfterPage) === pageNumber) {
            const error = new Error("simulated later-page authentication failure");
            error.code = -10001;
            throw error;
          }
          page = job.testMode
            ? { entries: pageNumber === 1 ? job.testEntries || [] : [], rawCount: pageNumber === 1 ? (job.testEntries || []).length : 0, hasMore: Boolean(job.testAuthAfterPage && pageNumber === 1), cursor: pageNumber === 1 ? "test-page-2" : "" }
            : await fetchMoodPage({
              uin: job.ownerUin,
              gTk: job.gTk,
              cursor,
              count: FEEDS3_PAGE_SIZE,
              scope: feedScope,
              signal: activeAbortController.signal,
              resetStaleCursor: pageNumber === 1 && Boolean(resumeCursor),
            });
        } catch (error) {
          pageError = error;
        }
        if (pageError && !job.testMode && isAuthenticationFailure(pageError?.code) && processedEntries > 0 && feedScope === 1 && !usedScopeFallback) {
          emit("progress", {
            jobId: job.jobId,
            progress: 70,
            phase: "switching_feed_scope",
            message: "个人时间线后续页暂不可用，正在尝试兼容读取路径…",
            changes,
          });
          try {
            page = await fetchMoodPage({
              uin: job.ownerUin,
              gTk: job.gTk,
              cursor: "",
              count: FEEDS3_PAGE_SIZE,
              scope: 0,
              signal: activeAbortController.signal,
              resetStaleCursor: false,
            });
            cursor = "";
            feedScope = 0;
            usedScopeFallback = true;
            paginationTruncated = {
              code: String(pageError.code),
              pageNumber,
              feedScope: 0,
              usedScopeFallback: true,
            };
            seenCursors.clear();
            page.diagnostic = { ...(page.diagnostic || {}), usedPaginationScopeFallback: true };
            pageError = null;
          } catch (fallbackError) {
            pageError = fallbackError;
          }
        }
        if (pageError) {
          if (isAuthenticationFailure(pageError?.code) && processedEntries > 0) {
            paginationTruncated = { code: String(pageError.code), pageNumber, feedScope };
            await store.writeDiagnostic("pagination-truncated", {
              reason: "later_page_rejected",
              parserCode: String(pageError.code),
              pageNumber,
              feedScope,
              savedEntries: counts.entries,
            });
            hasMore = false;
            break;
          }
          throw pageError;
        }
        feedScope = Number(page.requestScope) === 0 ? 0 : 1;
        if (page.resumeCursorReset) {
          await store.writeDiagnostic("resume-cursor-reset", {
            reason: "saved_cursor_rejected",
            parserCode: String(page.diagnostic?.rejectedCursorCode || ""),
            restartedFromFirstPage: true,
          });
          emit("progress", {
            jobId: job.jobId,
            progress: 31,
            phase: "resetting_resume_cursor",
            message: "原恢复点已过期，正在从第一页安全重新扫描…",
            changes,
          });
        }
        if (page.diagnostic) {
          pageDiagnostics.push({ pageNumber, ...page.diagnostic });
          await store.writeDiagnostic("feed-pages", { pages: pageDiagnostics.slice(-100) });
        }
        const pageChanges = { added: 0, updated: 0, skipped: 0 };
        for (const sourceEntry of page.entries) {
          throwIfCancelled();
          const inspection = await store.inspectEntry(sourceEntry, {
            includeComments: job.options.includeComments,
            includeLikes: job.options.includeLikes,
            includeMedia: job.options.includeMedia,
          });
          if (inspection.change === "skipped") {
            changes.skipped += 1;
            pageChanges.skipped += 1;
            continue;
          }
          const entry = {
            ...inspection.entry,
            media: [],
          };
          const existingMedia = new Map((inspection.existing?.media || []).map((media) => [String(media.sourceUrl || ""), media]));
          entry.media = await mapWithConcurrency(inspection.entry.media || [], 3, async (media) => {
            const preserved = existingMedia.get(String(media.sourceUrl || ""));
            if (!job.options.includeMedia) return preserved || media;
            if (job.testMode) return media;
            try {
              if (preserved?.localPath) {
                const verified = await store.getStoredMedia(media.sourceUrl);
                if (verified) return { ...preserved, localPath: verified.relativePath, contentType: verified.contentType, size: verified.size };
              }
              const indexedMedia = await store.getStoredMedia(media.sourceUrl);
              const stored = indexedMedia || await downloadMedia({ sourceUrl: media.sourceUrl, uin: job.ownerUin, signal: activeAbortController.signal })
                .then((downloaded) => store.writeMedia({ sourceUrl: media.sourceUrl, ...downloaded }));
              return { ...media, localPath: stored.relativePath, contentType: stored.contentType, size: stored.size };
            } catch (error) {
              if (activeAbortController.signal.aborted) throw error;
              if (mediaFailures.length < 100) mediaFailures.push({ sourceUrl: media.sourceUrl, error: String(error?.message || error).slice(0, 300) });
              return { ...media, downloadError: String(error?.message || error).slice(0, 300) };
            }
          });
          await store.writeEntry(entry);
          changes[inspection.change] += 1;
          pageChanges[inspection.change] += 1;
          processedEntries += 1;
        }
        counts = await store.summarize();
        const nextCursor = String(page.cursor || "");
        const reachedKnownPage = incrementalMode
          && page.entries.length > 0
          && pageChanges.added === 0
          && pageChanges.updated === 0
          && pageChanges.skipped === page.entries.length;
        if (reachedKnownPage) stoppedAtKnownPage = true;
        const progress = Math.min(92, 30 + Math.round(62 * (1 - Math.exp(-pageNumber / 10))));
        emit("progress", {
          jobId: job.jobId,
          progress,
          phase: "collecting_posts",
          message: `已导入 ${counts.entries} 条内容，正在处理第 ${pageNumber} 页…`,
          changes,
        });
        await store.writeCheckpoint({ jobId: job.jobId, phase: "collecting_posts", cursors: { posts: nextCursor, postScope: feedScope }, counts });
        hasMore = Boolean(!reachedKnownPage && page.hasMore && nextCursor && nextCursor !== cursor && !seenCursors.has(nextCursor));
        if (nextCursor) seenCursors.add(nextCursor);
        cursor = nextCursor;
        activeCursors = { posts: cursor, postScope: feedScope };
        if (hasMore && !job.testMode) await abortableDelay(1200 + Math.floor(Math.random() * 600), activeAbortController.signal);
      }
      if (hasMore) throw new Error("说说页数超过 500 页安全限制，已保存恢复点，可再次运行继续");
      if (!processedEntries && !counts.entries) await store.writeDiagnostic("empty-post-stream", { message: "接口成功返回，但没有找到本人可归档的说说" });
    }

    if (mediaFailures.length) await store.writeDiagnostic("media-download-failures", { count: mediaFailures.length, items: mediaFailures });

    emit("progress", { jobId: job.jobId, progress: 96, phase: "archive_ready", message: "正在写入归档清单与本地索引…" });
    throwIfCancelled();
    if (parserMigration) counts = await store.mergeParserMigrationPrevious(parserMigration);
    counts = await store.summarize();
    await store.complete({
      jobId: job.jobId,
      status: paginationTruncated ? "partial" : "complete",
      counts,
      changes,
      fullScanCompleted: !stoppedAtKnownPage && !paginationTruncated,
      cursors: paginationTruncated ? activeCursors : {},
    });
    if (parserMigration) {
      await store.commitParserMigration(parserMigration);
      parserMigration = null;
    }
    emit("complete", {
      jobId: job.jobId,
      progress: 100,
      archivePath: job.archiveRoot,
      counts,
      changes,
      mode: paginationTruncated ? "partial" : stoppedAtKnownPage ? "incremental" : "full",
      truncated: Boolean(paginationTruncated),
      schemaVersion: 1,
      phase: paginationTruncated ? "collection_partial" : "collection_complete",
      message: paginationTruncated
        ? `QQ 暂未继续返回更早内容，已保存当前可读取的 ${counts.entries} 条内容`
        : `已将 ${counts.entries} 条内容写入本地档案`,
    });
  } catch (error) {
    const cancelled = activeAbortController?.signal.aborted;
    try {
      if (parserMigration) {
        const restored = await store.rollbackParserMigration(parserMigration, {
          reason: cancelled ? "collection_cancelled" : "collection_failed",
        });
        parserMigration = null;
        counts = restored?.counts || counts;
        activeCursors = restored?.cursors || activeCursors;
      }
      if (!cancelled) {
        await store.writeDiagnostic("collection-error", {
          name: String(error?.name || "Error"),
          code: String(error?.code || ""),
          message: String(error?.message || error).slice(0, 500),
          response: error?.diagnostic || null,
        });
      }
      await store.writeCheckpoint({ jobId: job.jobId, phase: cancelled ? "cancelled" : "failed", cursors: activeCursors, counts, error: cancelled ? null : String(error?.message || error) });
    } catch {
      // Preserve the original collector error.
    }
    emit(cancelled ? "cancelled" : "error", {
      jobId: job.jobId,
      archivePath: job.archiveRoot,
      phase: !cancelled && isAuthenticationFailure(error?.code) ? "authentication_required" : "collection_failed",
      counts,
      changes,
      message: cancelled ? "采集任务已取消，恢复点已经保留" : String(error?.message || error || "采集进程失败"),
    });
  } finally {
    activeJob = null;
    activeAbortController = null;
  }
}

parentPort.on("message", (event) => {
  const message = event?.data || event;
  if (message?.type === "start") {
    void run(message.job);
    return;
  }
  if (message?.type === "cancel" && activeJob?.jobId === message.jobId) activeAbortController?.abort();
});
