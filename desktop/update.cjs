const RELEASES_API = "https://api.github.com/repos/Socialist-Sister/qzone-journal/releases?per_page=20";
const RELEASES_ATOM = "https://github.com/Socialist-Sister/qzone-journal/releases.atom";
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
    return parsed.protocol === "https:"
      && parsed.hostname === "github.com"
      && /^\/Socialist-Sister\/qzone-journal\/releases\/tag\/v?\d+\.\d+\.\d+(?:-alpha)?\/?$/i.test(parsed.pathname)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
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

async function readBoundedText(response) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("版本信息响应过大");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("版本信息响应过大");
  return text;
}

async function readBoundedJson(response) {
  return JSON.parse(await readBoundedText(response));
}

function chooseLatestAtomRelease(xml) {
  const urls = String(xml || "").match(/https:\/\/github\.com\/Socialist-Sister\/qzone-journal\/releases\/tag\/v?\d+\.\d+\.\d+(?:-alpha)?/gi) || [];
  return chooseLatestRelease([...new Set(urls)].map((htmlUrl) => ({
    tag_name: htmlUrl.split("/").pop(),
    html_url: htmlUrl,
    draft: false,
    prerelease: /-alpha$/i.test(htmlUrl),
    assets: [],
  })));
}

function updateResult(currentVersion, latest, checksumsAvailable = false) {
  if (!latest) throw new Error("GitHub 未返回可识别的版本信息");
  return {
    checked: true,
    updateAvailable: compareVersions(latest.tag_name, currentVersion) > 0,
    currentVersion,
    latestVersion: String(latest.tag_name).replace(/^v/i, ""),
    releaseUrl: validReleaseUrl(latest.html_url),
    prerelease: Boolean(latest.prerelease),
    checksumsAvailable,
  };
}

async function checkForUpdates(currentVersion, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持版本检查");
  try {
    const response = await fetchImpl(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `qzone-journal/${currentVersion}` },
      redirect: "error",
      signal,
    });
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
    const latest = chooseLatestRelease(await readBoundedJson(response));
    const assetNames = (Array.isArray(latest?.assets) ? latest.assets : []).map((asset) => String(asset?.name || ""));
    return updateResult(currentVersion, latest, assetNames.some((name) => /^SHA256SUMS(?:\.txt)?$/i.test(name)));
  } catch (apiError) {
    if (signal?.aborted) throw new Error("检查更新超时，请稍后重试", { cause: apiError });
  }

  try {
    const response = await fetchImpl(RELEASES_ATOM, {
      headers: { Accept: "application/atom+xml", "User-Agent": `qzone-journal/${currentVersion}` },
      redirect: "error",
      signal,
    });
    if (!response.ok) throw new Error(`GitHub Release HTTP ${response.status}`);
    return updateResult(currentVersion, chooseLatestAtomRelease(await readBoundedText(response)));
  } catch (fallbackError) {
    if (signal?.aborted) throw new Error("检查更新超时，请稍后重试", { cause: fallbackError });
    throw new Error("无法连接 GitHub 检查更新，请确认代理或防火墙设置后重试", { cause: fallbackError });
  }
}

module.exports = { MAX_RESPONSE_BYTES, RELEASES_API, RELEASES_ATOM, checkForUpdates, chooseLatestAtomRelease, chooseLatestRelease, compareVersions, parseVersion, validReleaseUrl };
