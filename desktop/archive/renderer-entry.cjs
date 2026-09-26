const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { normalizeQzoneMentions } = require("../collector/qzone-parser.cjs");

function toRendererArchiveEntry(entry, archiveRoot) {
  const date = entry.createdAt || "";
  const dateValue = date ? new Date(date) : null;
  const localMediaUrl = (relativePath) => {
    if (!relativePath) return "";
    const mediaPath = path.resolve(archiveRoot, ...String(relativePath).split("/"));
    if (!mediaPath.startsWith(`${archiveRoot}${path.sep}`)) return "";
    return pathToFileURL(mediaPath).href;
  };
  const archivedMedia = Array.isArray(entry.media) ? entry.media : [];
  const media = archivedMedia.flatMap((item, index) => {
    const kind = item?.kind === "video" || String(item?.contentType || "").startsWith("video/") ? "video" : "image";
    const src = localMediaUrl(item?.localPath);
    if (kind === "image") return src ? [{ kind, src }] : [];
    return [{
      kind,
      id: String(item?.videoId || `${entry.sourceId}-video-${index}`),
      src,
      poster: localMediaUrl(item?.posterLocalPath),
      contentType: String(item?.contentType || "video/mp4"),
      durationMs: Math.max(0, Number(item?.durationMs) || 0),
      width: Math.max(0, Number(item?.width) || 0),
      height: Math.max(0, Number(item?.height) || 0),
      available: Boolean(src),
    }];
  });
  const images = media.filter((item) => item.kind === "image").map((item) => item.src);
  const videos = media.filter((item) => item.kind === "video");
  const visibleLikes = (Array.isArray(entry.likes) ? entry.likes : []).map((like) => String(like?.name || like?.nickname || "QQ 用户"));
  const visibleComments = (Array.isArray(entry.comments) ? entry.comments : []).map((comment) => ({
    authorName: normalizeQzoneMentions(comment?.authorName || comment?.author || comment?.name || "QQ 用户"),
    text: normalizeQzoneMentions(comment?.text || comment?.content),
  }));
  return {
    id: String(entry.sourceId),
    type: ["post", "journal", "album"].includes(entry.type) ? entry.type : "post",
    date,
    displayDate: dateValue && !Number.isNaN(dateValue.valueOf())
      ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(dateValue)
      : "时间未知",
    title: entry.title || null,
    text: normalizeQzoneMentions(entry.text),
    links: (Array.isArray(entry.links) ? entry.links : []).flatMap((link) => {
      try {
        const url = new URL(String(link?.url || ""));
        if (url.protocol !== "https:") return [];
        return [{ url: url.toString(), label: String(link?.label || url.hostname).slice(0, 200) }];
      } catch {
        return [];
      }
    }),
    location: entry.location || null,
    images,
    videos,
    media,
    mediaCount: images.length + videos.length,
    likes: visibleLikes,
    likeCount: Math.max(visibleLikes.length, Number(entry.metrics?.likeCount) || 0),
    comments: visibleComments,
    commentCount: Math.max(visibleComments.length, Number(entry.metrics?.commentCount) || 0),
  };
}

module.exports = { toRendererArchiveEntry };
