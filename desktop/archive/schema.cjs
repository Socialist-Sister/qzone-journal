const { randomUUID } = require("node:crypto");

const ARCHIVE_SCHEMA_VERSION = 1;
const CONTENT_TYPES = new Set(["posts", "albums", "comments", "likes"]);

function isoNow() {
  return new Date().toISOString();
}

function sanitizeCollectionOptions(input) {
  const requested = Array.isArray(input?.items) ? input.items : [];
  const items = [...new Set(requested.map(String).filter((item) => CONTENT_TYPES.has(item)))];
  if (!items.length) throw new Error("至少选择一项备份内容");
  return {
    items,
    includeComments: items.includes("comments"),
    includeLikes: items.includes("likes"),
    includeMedia: items.includes("albums") || items.includes("posts"),
  };
}

function createManifest({ ownerUin, jobId, options, existing }) {
  const now = isoNow();
  return {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    archiveId: existing?.archiveId || randomUUID(),
    source: { platform: "qzone", ownerUin: String(ownerUin) },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    collection: {
      status: "preparing",
      activeJobId: jobId,
      lastCompletedAt: existing?.collection?.lastCompletedAt || null,
      options,
      counts: existing?.collection?.counts || { entries: 0, media: 0, mediaBytes: 0, comments: 0, likes: 0 },
      highWater: existing?.collection?.highWater || null,
      lastFullScanAt: existing?.collection?.lastFullScanAt || null,
      lastRun: existing?.collection?.lastRun || null,
      deletionPolicy: "retain_unseen",
    },
    storage: {
      recordsDirectory: "records",
      mediaDirectory: "media",
      stateDirectory: "state",
      diagnosticsDirectory: "diagnostics",
    },
  };
}

function normalizeArchiveEntry(entry) {
  const sourceId = String(entry?.sourceId || entry?.id || "").trim();
  if (!sourceId) throw new Error("归档条目缺少 sourceId");
  const type = String(entry?.type || "post");
  if (!new Set(["post", "journal", "album"]).has(type)) throw new Error(`不支持的条目类型：${type}`);
  return {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    sourceId,
    type,
    createdAt: String(entry?.createdAt || entry?.date || ""),
    updatedAt: entry?.updatedAt ? String(entry.updatedAt) : null,
    title: entry?.title ? String(entry.title) : null,
    text: String(entry?.text || ""),
    links: Array.isArray(entry?.links) ? entry.links.slice(0, 20).flatMap((link) => {
      try {
        const url = new URL(String(link?.url || ""));
        if (url.protocol !== "https:") return [];
        return [{ url: url.toString(), label: String(link?.label || url.hostname).slice(0, 200) }];
      } catch {
        return [];
      }
    }) : [],
    location: entry?.location ? String(entry.location) : null,
    visibility: entry?.visibility ? String(entry.visibility) : "unknown",
    media: Array.isArray(entry?.media) ? entry.media : [],
    comments: (Array.isArray(entry?.comments) ? entry.comments : []).map((comment) => ({
      id: comment?.id ? String(comment.id) : undefined,
      authorName: String(comment?.authorName || comment?.author || comment?.name || "QQ 用户"),
      text: String(comment?.text || comment?.content || ""),
      isReply: Boolean(comment?.isReply),
      parentId: comment?.parentId ? String(comment.parentId) : null,
      createdAt: comment?.createdAt ? String(comment.createdAt) : "",
      source: comment?.source ? String(comment.source) : "unknown",
    })),
    likes: (Array.isArray(entry?.likes) ? entry.likes : []).map((like) => ({
      name: String(like?.name || like?.nickname || like || "QQ 用户"),
      source: like?.source ? String(like.source) : "unknown",
    })),
    metrics: entry?.metrics && typeof entry.metrics === "object" ? entry.metrics : {},
    sourceMeta: entry?.sourceMeta && typeof entry.sourceMeta === "object" ? {
      adapter: entry.sourceMeta.adapter ? String(entry.sourceMeta.adapter) : "unknown",
      parserVersion: Math.max(1, Number(entry.sourceMeta.parserVersion) || 1),
      appid: entry.sourceMeta.appid ? String(entry.sourceMeta.appid) : undefined,
      typeId: entry.sourceMeta.typeId ? String(entry.sourceMeta.typeId) : undefined,
      isForward: Boolean(entry.sourceMeta.isForward),
      originalSourceId: entry.sourceMeta.originalSourceId ? String(entry.sourceMeta.originalSourceId) : null,
      authorNickname: entry.sourceMeta.authorNickname ? String(entry.sourceMeta.authorNickname) : "",
      shareTitle: entry.sourceMeta.shareTitle ? String(entry.sourceMeta.shareTitle) : null,
      sourceName: entry.sourceMeta.sourceName ? String(entry.sourceMeta.sourceName) : null,
      commentCountReported: Boolean(entry.sourceMeta.commentCountReported),
      likeCountReported: Boolean(entry.sourceMeta.likeCountReported),
      likeDetailsFetchedAt: entry.sourceMeta.likeDetailsFetchedAt ? String(entry.sourceMeta.likeDetailsFetchedAt) : null,
      likeDetailsStatus: ["complete", "empty"].includes(entry.sourceMeta.likeDetailsStatus) ? entry.sourceMeta.likeDetailsStatus : null,
    } : {},
    collectedAt: isoNow(),
  };
}

module.exports = {
  ARCHIVE_SCHEMA_VERSION,
  createManifest,
  isoNow,
  normalizeArchiveEntry,
  sanitizeCollectionOptions,
};
