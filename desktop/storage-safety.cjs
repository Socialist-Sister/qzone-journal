const fs = require("node:fs/promises");

const MINIMUM_FREE_SPACE_BYTES = 128 * 1024 * 1024;

async function assertMinimumFreeSpace(directory, { minimumBytes = MINIMUM_FREE_SPACE_BYTES, statfs = fs.statfs } = {}) {
  if (typeof statfs !== "function") return { checked: false, availableBytes: null };
  let stats;
  try {
    stats = await statfs(directory);
  } catch (error) {
    if (["ENOSYS", "ENOTSUP", "UNKNOWN"].includes(error?.code)) return { checked: false, availableBytes: null };
    throw error;
  }
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  if (Number.isFinite(availableBytes) && availableBytes < minimumBytes) {
    const error = new Error("保存位置可用空间不足 128 MB，请清理磁盘或更换保存位置后重试");
    error.code = "QZONE_DISK_SPACE_LOW";
    error.availableBytes = availableBytes;
    throw error;
  }
  return { checked: true, availableBytes };
}

module.exports = { MINIMUM_FREE_SPACE_BYTES, assertMinimumFreeSpace };
