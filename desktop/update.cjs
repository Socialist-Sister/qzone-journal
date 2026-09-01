const RELEASES_API = "https://api.github.com/repos/Socialist-Sister/qzone-journal/releases?per_page=20";
const MAX_RESPONSE_BYTES = 1024 * 1024;

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(-alpha)?$/i);
  if (!match) return null;
  return { raw: match[0], parts: match.slice(1, 4).map(Number), alpha: Boolean(match[4]) };
}

function compareVersions(left, right) {
  const a = typeof left === "string" ? parseVersion(left) : left;
  const b = typeof right === "string" ? parseVersion(right) : right;
  if (!a || !b) throw new Error("无法比较无效版本号");
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1;
  }
  if (a.alpha !== b.alpha) return a.alpha ? -1 : 1;
  return 0;
}

function validReleaseUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && parsed.hostname === "github.com" && !parsed.username && !parsed.password
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function chooseLatestRelease(releases) {
  return (Array.isArray(releases) ? releases : [])
    .filter((release) => !release?.draft && parseVersion(release?.tag_name) && validReleaseUrl(release?.html_url))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] || null;
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("版本信息响应过大");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("版本信息响应过大");
  return JSON.parse(text);
}

async function checkForUpdates(currentVersion, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持版本检查");
  const response = await fetchImpl(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `qzone-journal/${currentVersion}` },
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error(`版本检查失败（HTTP ${response.status}）`);
  const latest = chooseLatestRelease(await readBoundedJson(response));
  if (!latest) return { checked: true, updateAvailable: false, currentVersion, latestVersion: currentVersion };
  const assetNames = (Array.isArray(latest.assets) ? latest.assets : []).map((asset) => String(asset?.name || ""));
  return {
    checked: true,
    updateAvailable: compareVersions(latest.tag_name, currentVersion) > 0,
    currentVersion,
    latestVersion: String(latest.tag_name).replace(/^v/i, ""),
    releaseUrl: validReleaseUrl(latest.html_url),
    prerelease: Boolean(latest.prerelease),
    checksumsAvailable: assetNames.some((name) => /^SHA256SUMS(?:\.txt)?$/i.test(name)),
  };
}

module.exports = { MAX_RESPONSE_BYTES, RELEASES_API, checkForUpdates, chooseLatestRelease, compareVersions, parseVersion, validReleaseUrl };
