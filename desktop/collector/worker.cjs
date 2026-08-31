const { ArchiveStore } = require("../archive/store.cjs");
const { MOOD_PAGE_SIZE, abortableDelay, createCollectionPlan, downloadMedia, fetchLikeList, fetchMoodPage, probeSession } = require("./qzone-adapter.cjs");
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
  const changedSourceIds = new Set();
  let incrementalMode = false;
  let stoppedAtKnownPage = false;
  let paginationTruncated = null;
  let interactionTruncated = null;
  let adapterHealth = { status: "healthy", adapter: "mood_list", message: "QQ 说说分类接口工作正常" };

  try {
    emit("progress", { jobId: job.jobId, progress: 5, phase: "initializing", message: "正在建立本地归档目录…" });
    const previousCheckpoint = await store.readCheckpoint();
    const initialization = await store.initialize({ ownerUin: job.ownerUin, jobId: job.jobId, options: job.options });
    counts = await store.summarize();
    const previousAdapter = String(previousCheckpoint?.cursors?.postAdapter || "");
    const canResume = !initialization.migrationRequired
      && ["collecting_posts", "cancelled", "failed", "partial"].includes(previousCheckpoint?.phase)
      && ["mood_list", "feeds3_personal"].includes(previousAdapter);
    let resumeCursor = canResume ? String(previousCheckpoint?.cursors?.posts || "") : "";
    let resumeAdapter = canResume ? previousAdapter : "mood_list";
    const lastFullScanAt = Date.parse(String(initialization.manifest.collection?.lastFullScanAt || ""));
    const fullScanDue = !Number.isFinite(lastFullScanAt) || Date.now() - lastFullScanAt >= 30 * 24 * 60 * 60 * 1000;
    incrementalMode = counts.entries > 0 && !canResume && !initialization.migrationRequired && !fullScanDue;
    activeCursors = { posts: resumeCursor, postAdapter: resumeAdapter, likes: 0 };
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
      resumeAdapter = "mood_list";
      activeCursors = { posts: "", postAdapter: resumeAdapter, likes: 0 };
    }
    const plan = createCollectionPlan(job.options);
    throwIfCancelled();
    await store.writeDiagnostic("collection-plan", { items: plan });
    let cursor = resumeCursor;
    let postAdapter = resumeAdapter;
    activeCursors = { posts: cursor, postAdapter, likes: 0 };
    await store.writeCheckpoint({ jobId: job.jobId, phase: "adapter_ready", cursors: activeCursors, counts });

    const needsPostStream = job.options.items.some((item) => ["posts", "comments", "likes"].includes(item));
    if (needsPostStream) {
      let pageNumber = 0;
      let processedEntries = 0;
      let hasMore = true;
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
            ? { adapter: "mood_list", entries: pageNumber === 1 ? job.testEntries || [] : [], rawCount: pageNumber === 1 ? (job.testEntries || []).length : 0, hasMore: Boolean(job.testAuthAfterPage && pageNumber === 1), cursor: pageNumber === 1 ? "20" : "", total: (job.testEntries || []).length }
            : await fetchMoodPage({
              uin: job.ownerUin,
              gTk: job.gTk,
              cursor,
              count: MOOD_PAGE_SIZE,
              adapter: postAdapter,
              signal: activeAbortController.signal,
              resetStaleCursor: pageNumber === 1 && Boolean(resumeCursor),
            });
        } catch (error) {
          pageError = error;
        }
        if (pageError) {
          const recoverableBoundary = isAuthenticationFailure(pageError?.code) || pageError?.code === "QZONE_MOOD_RATE_LIMITED";
          if (recoverableBoundary && processedEntries > 0) {
            paginationTruncated = { code: String(pageError.code), pageNumber, postAdapter };
            await store.writeDiagnostic("pagination-truncated", {
              reason: "later_page_rejected",
              parserCode: String(pageError.code),
              pageNumber,
              postAdapter,
              savedEntries: counts.entries,
            });
            hasMore = false;
            break;
          }
          throw pageError;
        }
        postAdapter = page.adapter === "feeds3_personal" ? "feeds3_personal" : "mood_list";
        if (postAdapter === "feeds3_personal") {
          adapterHealth = {
            status: "degraded",
            adapter: postAdapter,
            message: "QQ 说说分类接口暂时不可用，本次改用仅包含本人内容的兼容读取路径",
          };
        }
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
          const embeddedLikeCount = Math.max(sourceEntry.likes?.length || 0, Number(sourceEntry.metrics?.likeCount) || 0);
          const embeddedCommentCount = Math.max(sourceEntry.comments?.length || 0, Number(sourceEntry.metrics?.commentCount) || 0);
          const hasEmbeddedLikeState = Boolean(sourceEntry.sourceMeta?.likeCountReported)
            && (sourceEntry.likes?.length || 0) >= embeddedLikeCount;
          const hasEmbeddedCommentState = Boolean(sourceEntry.sourceMeta?.commentCountReported)
            && (sourceEntry.comments?.length || 0) >= embeddedCommentCount;
          const inspection = await store.inspectEntry(sourceEntry, {
            includeComments: job.options.includeComments && hasEmbeddedCommentState,
            includeLikes: job.options.includeLikes && hasEmbeddedLikeState,
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
          changedSourceIds.add(String(entry.sourceId));
          pageChanges[inspection.change] += 1;
          processedEntries += 1;
        }
        await store.flushIndexes();
        counts = await store.summarize();
        const nextCursor = String(page.cursor || "");
        const reachedKnownPage = incrementalMode
          && page.entries.length > 0
          && pageChanges.added === 0
          && pageChanges.updated === 0
          && pageChanges.skipped === page.entries.length;
        if (reachedKnownPage) stoppedAtKnownPage = true;
        const completedInCategory = Number(page.offset || 0) + Number(page.rawCount || 0);
        const progress = Number(page.total) > 0
          ? Math.min(92, 30 + Math.round(62 * Math.min(1, completedInCategory / Number(page.total))))
          : Math.min(92, 30 + Math.round(62 * (1 - Math.exp(-pageNumber / 10))));
        const message = postAdapter === "mood_list"
          ? `已归档 ${counts.entries} 条说说，正在读取说说分类第 ${pageNumber} 页${page.total !== null && Number.isFinite(Number(page.total)) ? `（共 ${page.total} 条）` : ""}…`
          : `说说分类接口暂时繁忙，正在读取本人时间线第 ${pageNumber} 页（不会扫描好友动态）…`;
        emit("progress", {
          jobId: job.jobId,
          progress,
          phase: "collecting_posts",
          message,
          changes,
        });
        await store.writeCheckpoint({ jobId: job.jobId, phase: "collecting_posts", cursors: { posts: nextCursor, postAdapter }, counts });
        hasMore = Boolean(!reachedKnownPage && page.hasMore && nextCursor && nextCursor !== cursor && !seenCursors.has(nextCursor));
        if (nextCursor) seenCursors.add(nextCursor);
        cursor = nextCursor;
        activeCursors = { posts: cursor, postAdapter, likes: 0 };
        if (hasMore && !job.testMode) {
          const baseDelay = postAdapter === "mood_list" ? 450 : 1200;
          await abortableDelay(baseDelay + Math.floor(Math.random() * 450), activeAbortController.signal);
        }
      }
      if (hasMore) throw new Error("说说页数超过 500 页安全限制，已保存恢复点，可再次运行继续");
      if (!paginationTruncated) {
        cursor = "";
        activeCursors = { posts: "", postAdapter, likes: 0 };
      }
      if (!processedEntries && !counts.entries) await store.writeDiagnostic("empty-post-stream", { message: "接口成功返回，但没有找到本人可归档的说说" });
    }

    if (mediaFailures.length) await store.writeDiagnostic("media-download-failures", { count: mediaFailures.length, items: mediaFailures });

    if (job.options.includeLikes && counts.entries > 0) {
      let likeCursor = 0;
      let inspectedLikes = 0;
      let hasMoreLikeEntries = true;
      const likeDiagnostics = [];
      while (hasMoreLikeEntries && !interactionTruncated) {
        throwIfCancelled();
        const page = await store.readEntriesPage({ cursor: likeCursor, limit: 20, type: "post" });
        if (!page.entries.length) break;
        for (const storedEntry of page.entries) {
          throwIfCancelled();
          inspectedLikes += 1;
          activeCursors = { posts: cursor, postAdapter, likes: inspectedLikes };
          const fetchedAt = Date.parse(String(storedEntry.sourceMeta?.likeDetailsFetchedAt || ""));
          const fresh = Number.isFinite(fetchedAt)
            && Date.now() - fetchedAt < 24 * 60 * 60 * 1000
            && ["complete", "empty"].includes(storedEntry.sourceMeta?.likeDetailsStatus);
          if (fresh) continue;

          const currentLikes = Array.isArray(storedEntry.likes) ? storedEntry.likes : [];
          const currentTotal = Math.max(currentLikes.length, Number(storedEntry.metrics?.likeCount) || 0);
          const embeddedComplete = Boolean(storedEntry.sourceMeta?.likeCountReported) && currentLikes.length >= currentTotal;
          let result;
          try {
            if (job.testMode && job.testLikeErrorCode) {
              const error = new Error("simulated like-list boundary");
              error.code = job.testLikeErrorCode;
              throw error;
            }
            result = embeddedComplete
              ? { likes: currentLikes, total: currentTotal, diagnostics: [] }
              : job.testMode
                ? job.testLikeDetails?.[storedEntry.sourceId] || { likes: currentLikes, total: currentTotal, diagnostics: [] }
                : await fetchLikeList({
                  uin: job.ownerUin,
                  tid: storedEntry.sourceId,
                  gTk: job.gTk,
                  signal: activeAbortController.signal,
                });
          } catch (error) {
            if (activeAbortController.signal.aborted) throw error;
            interactionTruncated = {
              code: String(error?.code || "QZONE_INTERACTION_UNAVAILABLE"),
              reason: isAuthenticationFailure(error?.code) ? "authentication" : error?.code === "QZONE_INTERACTION_RATE_LIMITED" ? "rate_limited" : "unavailable",
              processed: inspectedLikes - 1,
            };
            await store.writeDiagnostic("like-enrichment-partial", {
              reason: interactionTruncated.reason,
              parserCode: interactionTruncated.code,
              processedEntries: interactionTruncated.processed,
              totalEntries: page.page.total,
              response: error?.diagnostic || null,
            });
            break;
          }

          const nextLikes = (Array.isArray(result.likes) ? result.likes : []).slice(0, 3000).map((person) => ({
            name: String(person?.name || person?.nickname || "QQ 用户"),
            source: String(person?.source || "qzone_like_list"),
          }));
          const nextTotal = Math.max(nextLikes.length, currentTotal, Number(result.total) || 0);
          const now = new Date().toISOString();
          const updatedEntry = {
            ...storedEntry,
            likes: nextLikes,
            metrics: { ...(storedEntry.metrics || {}), likeCount: nextTotal },
            sourceMeta: {
              ...(storedEntry.sourceMeta || {}),
              likeDetailsFetchedAt: now,
              likeDetailsStatus: nextLikes.length ? "complete" : "empty",
            },
          };
          const beforeNames = currentLikes.map((person) => String(person?.name || person?.nickname || person || "")).join("\n");
          const afterNames = nextLikes.map((person) => person.name).join("\n");
          const interactionChanged = beforeNames !== afterNames || currentTotal !== nextTotal;
          await store.writeEntry(updatedEntry);
          if (interactionChanged && !changedSourceIds.has(String(storedEntry.sourceId))) {
            changes.updated += 1;
            changedSourceIds.add(String(storedEntry.sourceId));
          }
          if (result.diagnostics?.length && likeDiagnostics.length < 100) {
            likeDiagnostics.push({ entryNumber: inspectedLikes, pages: result.diagnostics });
          }
          counts = await store.summarize();
          const interactionProgress = Math.min(95, 92 + Math.floor(3 * inspectedLikes / Math.max(1, page.page.total)));
          emit("progress", {
            jobId: job.jobId,
            progress: interactionProgress,
            phase: "collecting_likes",
            message: `正在补充点赞名单（${inspectedLikes}/${page.page.total}）…`,
            changes,
          });
          await store.writeCheckpoint({ jobId: job.jobId, phase: "collecting_likes", cursors: activeCursors, counts });
          if (!embeddedComplete && !job.testMode) {
            await abortableDelay(1600 + Math.floor(Math.random() * 700), activeAbortController.signal);
          }
        }
        await store.flushIndexes();
        likeCursor = Number(page.page.nextCursor || 0);
        hasMoreLikeEntries = Boolean(page.page.hasMore && page.page.nextCursor);
      }
      if (likeDiagnostics.length) await store.writeDiagnostic("like-enrichment-pages", { items: likeDiagnostics });
      counts = await store.summarize();
    }

    emit("progress", { jobId: job.jobId, progress: 96, phase: "archive_ready", message: "正在写入归档清单与本地索引…" });
    throwIfCancelled();
    if (parserMigration) counts = await store.mergeParserMigrationPrevious(parserMigration);
    await store.flushIndexes();
    counts = await store.summarize();
    await store.complete({
      jobId: job.jobId,
      status: paginationTruncated || interactionTruncated ? "partial" : "complete",
      counts,
      changes,
      fullScanCompleted: !stoppedAtKnownPage && !paginationTruncated,
      cursors: paginationTruncated || interactionTruncated ? activeCursors : {},
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
      mode: paginationTruncated || interactionTruncated ? "partial" : stoppedAtKnownPage ? "incremental" : "full",
      truncated: Boolean(paginationTruncated || interactionTruncated),
      partialReason: paginationTruncated ? "timeline" : interactionTruncated ? "likes" : undefined,
      adapterHealth: paginationTruncated
        ? { status: "partial", adapter: postAdapter, message: "QQ 未继续返回更早内容，已保存恢复点，可稍后继续" }
        : interactionTruncated
          ? { status: "partial", adapter: "like_list", message: "说说正文已经保存；QQ 暂未继续返回点赞名单，已保留互动补充进度" }
        : adapterHealth,
      schemaVersion: 1,
      phase: paginationTruncated || interactionTruncated ? "collection_partial" : "collection_complete",
      message: paginationTruncated
        ? `QQ 暂未继续返回更早内容，已保存当前可读取的 ${counts.entries} 条内容`
        : interactionTruncated
          ? `已保存 ${counts.entries} 条内容；点赞名单可在稍后再次备份时继续补充`
        : `已将 ${counts.entries} 条内容写入本地档案`,
    });
  } catch (error) {
    const cancelled = activeAbortController?.signal.aborted;
    try {
      await store.flushIndexes();
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
