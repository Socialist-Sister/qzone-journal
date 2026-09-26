const path = require("node:path");
const { fileURLToPath } = require("node:url");

function parseUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isPathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function isTrustedAppUrl(targetUrl, { packaged, devServerUrl, clientRoot }) {
  const parsed = parseUrl(targetUrl);
  if (!parsed) return false;
  if (!packaged) {
    const dev = parseUrl(devServerUrl);
    return Boolean(dev && parsed.origin === dev.origin && parsed.pathname.startsWith(dev.pathname));
  }
  if (parsed.protocol !== "file:") return false;
  try {
    return isPathInside(fileURLToPath(parsed), clientRoot);
  } catch {
    return false;
  }
}

function isSafeExternalUrl(value) {
  const parsed = parseUrl(value);
  return Boolean(parsed && parsed.protocol === "https:" && parsed.hostname && !parsed.hostname.endsWith("."));
}

function restrictSessionPermissions(targetSession, { fullscreenWebContents, trustedAppUrl = () => false } = {}) {
  const allow = (webContents, permission, details) => Boolean(
    permission === "fullscreen"
    && webContents && webContents === fullscreenWebContents && !webContents.isDestroyed()
    && details?.isMainFrame === true
    && trustedAppUrl(webContents.getURL()) && trustedAppUrl(details.requestingUrl),
  );
  targetSession.setPermissionCheckHandler((webContents, permission, _origin, details) => allow(webContents, permission, details));
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => callback(allow(webContents, permission, details)));
}

module.exports = { isPathInside, isSafeExternalUrl, isTrustedAppUrl, parseUrl, restrictSessionPermissions };
