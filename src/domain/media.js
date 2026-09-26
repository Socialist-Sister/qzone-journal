function archiveMedia(entry) {
  // New desktop payloads preserve archive order; older archives and the demo use separate arrays.
  if (Array.isArray(entry?.media)) return entry.media;
  return [
    ...(Array.isArray(entry?.images) ? entry.images : []).map((src) => ({ kind: "image", src })),
    ...(Array.isArray(entry?.videos) ? entry.videos : []).map((video) => ({ ...video, kind: "video" })),
  ];
}

function videoDurationLabel(durationMs) {
  const totalSeconds = Math.round(Math.max(0, Number(durationMs) || 0) / 1000);
  if (!totalSeconds) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export { archiveMedia, videoDurationLabel };
