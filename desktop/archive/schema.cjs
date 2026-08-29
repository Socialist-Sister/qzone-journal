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
    location: entry?.location ? String(entry.location) : null,
    visibility: entry?.visibility ? String(entry.visibility) : "unknown",
    media: Array.isArray(entry?.media) ? entry.media : [],
    comments: Array.isArray(entry?.comments) ? entry.comments : [],
    likes: Array.isArray(entry?.likes) ? entry.likes : [],
    metrics: entry?.metrics && typeof entry.metrics === "object" ? entry.metrics : {},
    sourceMeta: entry?.sourceMeta && typeof entry.sourceMeta === "object" ? entry.sourceMeta : {},
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
