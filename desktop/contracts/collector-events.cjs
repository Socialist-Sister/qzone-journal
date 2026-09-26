// Only these counters may cross from the collection worker to the renderer.
const COUNT_FIELDS = ["entries", "media", "mediaBytes", "comments", "likes", "visibleComments", "visibleLikes"];
function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : 0;
}

function publicCollectorEvent(message) {
  const type = ["progress", "complete", "error", "cancelled"].includes(message?.type) ? message.type : "error";
  const changes = message?.changes && typeof message.changes === "object"
    ? {
        added: count(message.changes.added),
        updated: count(message.changes.updated),
        skipped: count(message.changes.skipped),
      }
    : undefined;
  return {
    type,
    jobId: String(message?.jobId || ""),
    progress: Math.max(0, Math.min(100, Number(message?.progress) || 0)),
    phase: message?.phase ? String(message.phase) : "",
    message: message?.message ? String(message.message).slice(0, 500) : "",
    // The service fills this using its own validated path, never a worker path.
    archivePath: "",
    counts: message?.counts && typeof message.counts === "object"
      ? Object.fromEntries(COUNT_FIELDS.map((field) => [field, count(message.counts[field])]))
      : undefined,
    changes,
    mode: type === "complete" && ["full", "incremental", "partial"].includes(message?.mode) ? message.mode : undefined,
    truncated: type === "complete" ? Boolean(message?.truncated) : undefined,
    partialReason: type === "complete" && ["timeline", "likes"].includes(message?.partialReason) ? message.partialReason : undefined,
    adapterHealth: type === "complete" && message?.adapterHealth && typeof message.adapterHealth === "object"
      ? {
          status: ["healthy", "degraded", "partial"].includes(message.adapterHealth.status) ? message.adapterHealth.status : "partial",
          adapter: String(message.adapterHealth.adapter || "unknown").slice(0, 80),
          message: String(message.adapterHealth.message || "").slice(0, 300),
        }
      : undefined,
    schemaVersion: type === "complete" ? Number(message?.schemaVersion) || 1 : undefined,
  };
}

module.exports = { publicCollectorEvent };
