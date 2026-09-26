

function readableError(error) {
  return String(error?.message || error || "操作失败")
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
}

function openProjectPage(pathname = "") {
  window.open(`https://github.com/Socialist-Sister/qzone-journal${pathname}`, "_blank", "noopener,noreferrer");
}

function formatFileSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function safeExternalUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

export { readableError, openProjectPage, formatFileSize, safeExternalUrl };
