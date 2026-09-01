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

function restrictSessionPermissions(targetSession) {
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

module.exports = { isPathInside, isSafeExternalUrl, isTrustedAppUrl, parseUrl, restrictSessionPermissions };
