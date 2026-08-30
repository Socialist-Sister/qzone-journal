const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatBackupRelativeTime(value, now = Date.now()) {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value || ""));
  const current = typeof now === "number" ? now : Date.parse(String(now || ""));
  if (!Number.isFinite(timestamp) || !Number.isFinite(current)) return "时间未知";

  const elapsed = Math.max(0, current - timestamp);
  if (elapsed < MINUTE) return "刚刚";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} 天前`;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(timestamp));
}
