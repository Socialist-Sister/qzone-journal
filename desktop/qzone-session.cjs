const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const QZONE_PARTITION = "qzone-journal-account";
const QZONE_ACCOUNT_PARTITION_PREFIX = "qzone-journal-account-";
const LEGACY_PERSISTENT_PARTITION = "persist:qzone-journal-account";
const LEGACY_PERSISTENT_PARTITION_PREFIX = "persist:qzone-journal-account-";
const QZONE_HOME_URL = "https://qzone.qq.com/";
const FEEDS3_AUTH_URL = "https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more";
const QZONE_PORTRAIT_URL = "https://r.qzone.qq.com/fcg-bin/cgi_get_portrait.fcg";
const AUTH_FAILURE_CODES = new Set([-3, -100, -3000, -10001, -10006]);
const LEGACY_ACCOUNT_ID = "legacy";

let accountRegistry = null;
let registryWrite = Promise.resolve();

function isAllowedQqUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && (parsed.hostname === "qq.com" || parsed.hostname.endsWith(".qq.com"));
  } catch {
    return false;
  }
}

function normalizeUin(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^\d{5,15}$/.test(digits) ? digits : "";
}

function normalizeNickname(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function qzoneAvatarUrl(uin) {
  const normalized = normalizeUin(uin);
  return normalized ? `https://q.qlogo.cn/headimg_dl?dst_uin=${encodeURIComponent(normalized)}&spec=100` : "";
}

function parseQzonePortraitResponse(value, uin) {
  const source = String(value || "").replace(/^\uFEFF/, "").trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const payload = JSON.parse(source.slice(start, end + 1));
    const normalizedUin = normalizeUin(uin);
    const record = payload?.[normalizedUin];
    const nickname = normalizeNickname(Array.isArray(record)
      ? record[6]
      : record?.nickname || record?.nick || record?.name);
    if (!nickname) return null;
    return { uin: normalizedUin, nickname, avatarUrl: qzoneAvatarUrl(normalizedUin) };
  } catch {
    return null;
  }
}

async function fetchQzoneProfile(uin, qzoneSession) {
  const normalizedUin = normalizeUin(uin);
  if (!normalizedUin) return null;
  try {
    const url = `${QZONE_PORTRAIT_URL}?uins=${encodeURIComponent(normalizedUin)}&_=${Date.now()}`;
    const response = await qzoneSession.fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        accept: "application/javascript, text/javascript, */*; q=0.01",
        referer: `https://user.qzone.qq.com/${encodeURIComponent(normalizedUin)}`,
      },
    });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const encodings = /charset\s*=\s*(?:gbk|gb2312|gb18030)/i.test(contentType)
      ? ["gb18030", "utf-8"]
      : ["utf-8", "gb18030"];
    for (const encoding of encodings) {
      try {
        const profile = parseQzonePortraitResponse(new TextDecoder(encoding).decode(bytes), normalizedUin);
        if (profile?.nickname && !profile.nickname.includes("\uFFFD")) return profile;
      } catch {
        // Try the other known encoding.
      }
    }
  } catch {
    // Profile metadata is optional; authenticated collection may continue.
  }
  return null;
}

function qzoneCookieScore(cookie) {
  const domain = String(cookie?.domain || "").replace(/^\./, "").toLowerCase();
  if (domain === "user.qzone.qq.com") return 4;
  if (domain.endsWith(".qzone.qq.com") || domain === "qzone.qq.com") return 3;
  if (domain === "qq.com") return 2;
  if (domain.endsWith(".qq.com")) return 1;
  return 0;
}

function selectQzoneCookie(cookies, name) {
  return (Array.isArray(cookies) ? cookies : [])
    .filter((cookie) => String(cookie?.name || "") === name && String(cookie?.value || ""))
    .sort((left, right) => qzoneCookieScore(right) - qzoneCookieScore(left))[0] || null;
}

function analyzeQzoneCookies(cookies) {
  const qqCookies = (Array.isArray(cookies) ? cookies : []).filter((cookie) => {
    const domain = String(cookie?.domain || "").replace(/^\./, "").toLowerCase();
    return domain === "qq.com" || domain.endsWith(".qq.com");
  });
  const uinCookie = selectQzoneCookie(qqCookies, "p_uin")
    || selectQzoneCookie(qqCookies, "uin")
    || selectQzoneCookie(qqCookies, "ptui_loginuin")
    || selectQzoneCookie(qqCookies, "media_p_uin");
  const uin = normalizeUin(uinCookie?.value);
  const sessionKeyCookie = selectQzoneCookie(qqCookies, "p_skey");
  return {
    authenticated: Boolean(uin && sessionKeyCookie?.value),
    uin,
    accountLabel: uin ? `QQ ${uin}` : "",
    nickname: "",
    avatarUrl: qzoneAvatarUrl(uin),
    cookieCount: qqCookies.length,
  };
}

function calculateGtk(value) {
  let hash = 5381;
  for (const char of String(value || "")) hash += (hash << 5) + char.charCodeAt(0);
  return hash & 0x7fffffff;
}

function accountsPath() {
  return path.join(app.getPath("userData"), "qzone-accounts.json");
}

function legacyAccount() {
  const now = new Date().toISOString();
  return { id: LEGACY_ACCOUNT_ID, partition: QZONE_PARTITION, uin: "", nickname: "", avatarUrl: "", accountLabel: "QQ 账号", createdAt: now, lastUsedAt: now };
}

function runtimePartition(accountId) {
  return accountId === LEGACY_ACCOUNT_ID ? QZONE_PARTITION : `${QZONE_ACCOUNT_PARTITION_PREFIX}${accountId}`;
}

function normalizeRegistry(value) {
  const input = value && typeof value === "object" ? value : {};
  const accounts = (Array.isArray(input.accounts) ? input.accounts : []).flatMap((account) => {
    const id = String(account?.id || "");
    if (!/^(?:legacy|[0-9a-f-]{36})$/i.test(id)) return [];
    const uin = normalizeUin(account?.uin);
    const nickname = normalizeNickname(account?.nickname);
    return [{
      id,
      partition: runtimePartition(id),
      uin,
      nickname,
      avatarUrl: qzoneAvatarUrl(uin),
      accountLabel: nickname || (uin ? `QQ ${uin}` : (id === LEGACY_ACCOUNT_ID && ["", "当前账号", "QQ账号"].includes(String(account?.accountLabel || ""))
        ? "QQ 账号"
        : String(account?.accountLabel || "QQ 账号").slice(0, 80))),
      createdAt: String(account?.createdAt || new Date().toISOString()),
      lastUsedAt: String(account?.lastUsedAt || new Date().toISOString()),
    }];
  });
  if (!accounts.length) accounts.push(legacyAccount());
  const activeAccountId = accounts.some((account) => account.id === input.activeAccountId)
    ? String(input.activeAccountId)
    : accounts[0].id;
  return { version: 3, activeAccountId, accounts };
}

async function ensureAccountRegistry() {
  if (accountRegistry) return accountRegistry;
  let stored = null;
  try {
    stored = JSON.parse(await fs.readFile(accountsPath(), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  const persistentPartitions = new Set();
  if (Number(stored?.version) < 2) {
    persistentPartitions.add(LEGACY_PERSISTENT_PARTITION);
    for (const account of Array.isArray(stored?.accounts) ? stored.accounts : []) {
      const partition = String(account?.partition || "");
      if (partition === LEGACY_PERSISTENT_PARTITION || partition.startsWith(LEGACY_PERSISTENT_PARTITION_PREFIX)) {
        persistentPartitions.add(partition);
      }
    }
  }
  accountRegistry = normalizeRegistry(stored);
  await Promise.all([...persistentPartitions].map(async (partition) => {
    const legacySession = session.fromPartition(partition, { cache: false });
    await legacySession.clearStorageData().catch(() => undefined);
    await legacySession.clearCache().catch(() => undefined);
  }));
  if (!stored || Number(stored.version) < 3 || persistentPartitions.size) await saveAccountRegistry();
  return accountRegistry;
}

async function saveAccountRegistry() {
  const snapshot = JSON.stringify(accountRegistry, null, 2);
  registryWrite = registryWrite.then(async () => {
    const target = accountsPath();
    const temporary = `${target}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, `${snapshot}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, target);
  });
  return registryWrite;
}

function activeAccountFromCache() {
  const registry = accountRegistry || normalizeRegistry(null);
  return registry.accounts.find((account) => account.id === registry.activeAccountId) || registry.accounts[0];
}

async function resolveAccount(accountId) {
  const registry = await ensureAccountRegistry();
  const id = accountId ? String(accountId) : registry.activeAccountId;
  const account = registry.accounts.find((item) => item.id === id);
  if (!account) throw new Error("没有找到这个 QQ 账号");
  return account;
}

function getQzoneSession(accountId) {
  const account = accountId && accountRegistry
    ? accountRegistry.accounts.find((item) => item.id === String(accountId))
    : activeAccountFromCache();
  return session.fromPartition(account?.partition || QZONE_PARTITION, { cache: true });
}

function buildAuthProbeUrl(uin, gTk) {
  const params = new URLSearchParams({
    uin: String(uin), scope: "1", view: "1", daylist: "", uinlist: "", gid: "", flag: "1",
    filter: "all", applist: "all", refresh: "1", pagenum: "1", begintime: "", dayspac: "5",
    sidomain: "qzonestyle.gtimg.cn", useutf8: "1", outputhtmlfeed: "1", format: "json", count: "1",
    rd: String(Math.random()), usertime: String(Date.now()), windowId: String(Math.random()), g_tk: String(gTk),
  });
  return `${FEEDS3_AUTH_URL}?${params}`;
}

async function validateQzoneSession(status, cookies, qzoneSession = getQzoneSession()) {
  const sessionKey = selectQzoneCookie(cookies, "p_skey")?.value || "";
  if (!status?.uin || !sessionKey) return false;
  try {
    const response = await qzoneSession.fetch(buildAuthProbeUrl(status.uin, calculateGtk(sessionKey)), {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        referer: `https://user.qzone.qq.com/${encodeURIComponent(status.uin)}`,
        "x-requested-with": "XMLHttpRequest",
      },
    });
    const body = await response.text();
    const finalHost = (() => { try { return new URL(response.url).hostname; } catch { return ""; } })();
    const codeMatch = String(body).slice(0, 1500).match(/(?:["']?code["']?)\s*[:=]\s*["']?(-?\d+)/i);
    const code = codeMatch ? Number(codeMatch[1]) : null;
    return response.ok
      && !finalHost.includes("ptlogin")
      && !finalHost.includes("xui.ptlogin2")
      && !AUTH_FAILURE_CODES.has(code)
      && code !== null;
  } catch {
    return false;
  }
}

async function inspectQzoneSession({ validate = false, accountId, account: suppliedAccount } = {}) {
  const account = suppliedAccount || await resolveAccount(accountId);
  const qzoneSession = session.fromPartition(account.partition, { cache: true });
  const cookies = await qzoneSession.cookies.get({});
  const cookieStatus = analyzeQzoneCookies(cookies);
  const identityUin = cookieStatus.uin || normalizeUin(account.uin);
  let result = {
    ...cookieStatus,
    uin: identityUin,
    nickname: normalizeNickname(account.nickname),
    avatarUrl: qzoneAvatarUrl(identityUin),
    accountLabel: normalizeNickname(account.nickname) || (identityUin ? `QQ ${identityUin}` : account.accountLabel || "QQ 账号"),
  };
  if (validate && cookieStatus.authenticated) {
    const authenticated = await validateQzoneSession(cookieStatus, cookies, qzoneSession);
    const profile = authenticated ? await fetchQzoneProfile(cookieStatus.uin, qzoneSession) : null;
    result = {
      ...result,
      authenticated,
      nickname: profile?.nickname || result.nickname,
      avatarUrl: profile?.avatarUrl || result.avatarUrl,
      accountLabel: profile?.nickname || result.nickname || result.accountLabel,
    };
  }
  return { ...result, accountId: account.id };
}

function publicSessionStatus(status) {
  return {
    authenticated: Boolean(status?.authenticated),
    uin: normalizeUin(status?.uin),
    nickname: normalizeNickname(status?.nickname),
    avatarUrl: qzoneAvatarUrl(status?.uin),
    accountLabel: normalizeNickname(status?.nickname) || status?.accountLabel || "",
    accountId: status?.accountId || "",
  };
}

async function updateAccountFromStatus(account, status, { makeActive = false } = {}) {
  const registry = await ensureAccountRegistry();
  const stored = registry.accounts.find((item) => item.id === account.id);
  if (!stored) registry.accounts.push(account);
  const target = registry.accounts.find((item) => item.id === account.id);
  const uin = normalizeUin(status?.uin);
  const nickname = normalizeNickname(status?.nickname);
  if (uin) target.uin = uin;
  if (nickname) target.nickname = nickname;
  target.avatarUrl = qzoneAvatarUrl(target.uin);
  target.accountLabel = target.nickname || (target.uin ? `QQ ${target.uin}` : status?.accountLabel || target.accountLabel || "QQ 账号");
  if (makeActive) {
    registry.activeAccountId = account.id;
    target.lastUsedAt = new Date().toISOString();
  }
  await saveAccountRegistry();
}

async function updateQzoneAccountProfile(accountId, profile = {}) {
  const account = await resolveAccount(accountId);
  await updateAccountFromStatus(account, profile);
  const updated = await resolveAccount(account.id);
  return {
    id: updated.id,
    uin: normalizeUin(updated.uin),
    nickname: normalizeNickname(updated.nickname),
    avatarUrl: qzoneAvatarUrl(updated.uin),
    accountLabel: updated.nickname || (updated.uin ? `QQ ${updated.uin}` : updated.accountLabel || "QQ 账号"),
  };
}

async function getQzoneRequestContext() {
  const account = await resolveAccount();
  const status = await inspectQzoneSession({ validate: true, account });
  if (!status.authenticated) throw new Error("QQ 登录会话不可用，请重新扫码登录");
  const cookies = await session.fromPartition(account.partition, { cache: true }).cookies.get({});
  const sessionKey = selectQzoneCookie(cookies, "p_skey")?.value || "";
  await updateAccountFromStatus(account, status);
  return { ...status, gTk: calculateGtk(sessionKey) };
}

async function clearQzoneCookies(accountId, suppliedAccount) {
  const account = suppliedAccount || await resolveAccount(accountId);
  const qzoneSession = session.fromPartition(account.partition, { cache: true });
  await qzoneSession.clearStorageData();
  await qzoneSession.clearCache().catch(() => undefined);
}

async function deleteQzoneAccount(accountId) {
  const registry = await ensureAccountRegistry();
  const account = await resolveAccount(accountId);
  await clearQzoneCookies(account.id, account);
  registry.accounts = registry.accounts.filter((item) => item.id !== account.id);
  if (!registry.accounts.length) registry.accounts.push(legacyAccount());
  if (!registry.accounts.some((item) => item.id === registry.activeAccountId)) {
    registry.activeAccountId = [...registry.accounts]
      .sort((left, right) => String(right.lastUsedAt).localeCompare(String(left.lastUsedAt)))[0].id;
  }
  await saveAccountRegistry();
  return listQzoneAccounts();
}

function configureQzoneSession(qzoneSession) {
  qzoneSession.setPermissionCheckHandler(() => false);
  qzoneSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

async function listQzoneAccounts() {
  const registry = await ensureAccountRegistry();
  const accounts = (await Promise.all(registry.accounts.map(async (account) => {
    const status = await inspectQzoneSession({ account });
    if (status.uin) account.uin = status.uin;
    if (status.nickname) account.nickname = status.nickname;
    account.avatarUrl = qzoneAvatarUrl(account.uin);
    account.accountLabel = account.nickname || (account.uin ? `QQ ${account.uin}` : account.accountLabel || "QQ 账号");
    if (!status.uin && !account.uin && account.accountLabel === "QQ 账号") return null;
    return {
      id: account.id,
      uin: normalizeUin(status.uin || account.uin),
      nickname: normalizeNickname(status.nickname || account.nickname),
      avatarUrl: qzoneAvatarUrl(status.uin || account.uin),
      accountLabel: normalizeNickname(status.nickname || account.nickname) || status.accountLabel || account.accountLabel || "当前账号",
      authenticated: Boolean(status.authenticated),
      active: account.id === registry.activeAccountId,
    };
  }))).filter(Boolean);
  await saveAccountRegistry();
  return { activeAccountId: registry.activeAccountId, accounts };
}

async function switchQzoneAccount(accountId) {
  const registry = await ensureAccountRegistry();
  const account = await resolveAccount(accountId);
  registry.activeAccountId = account.id;
  account.lastUsedAt = new Date().toISOString();
  await saveAccountRegistry();
  const sessionStatus = publicSessionStatus(await inspectQzoneSession({ validate: true, account }));
  return { ...(await listQzoneAccounts()), sessionStatus };
}

async function findRegisteredAccountByUin(uin, excludedAccountId) {
  if (!uin) return null;
  const registry = await ensureAccountRegistry();
  for (const account of registry.accounts) {
    if (account.id === excludedAccountId) continue;
    if (normalizeUin(account.uin) === normalizeUin(uin)) return account;
    const status = await inspectQzoneSession({ account });
    if (status.uin === uin) return account;
  }
  return null;
}

let loginWindow = null;
let loginPromise = null;

async function openQzoneLogin(parentWindow, { force = false, addAccount = false } = {}) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return loginPromise;
  }

  const newAccountId = addAccount ? randomUUID() : "";
  const account = addAccount
    ? { id: newAccountId, partition: runtimePartition(newAccountId), uin: "", nickname: "", avatarUrl: "", accountLabel: "新账号", createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() }
    : await resolveAccount();
  if (force) await clearQzoneCookies(account.id, account);
  if (!addAccount) {
    const existing = await inspectQzoneSession({ validate: true, account });
    if (existing.authenticated) {
      await updateAccountFromStatus(account, existing, { makeActive: true });
      return publicSessionStatus(existing);
    }
  }

  const qzoneSession = session.fromPartition(account.partition, { cache: true });
  configureQzoneSession(qzoneSession);
  loginWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    parent: parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined,
    modal: Boolean(parentWindow && !parentWindow.isDestroyed()),
    show: false,
    autoHideMenuBar: true,
    title: addAccount ? "添加 QQ 空间账号" : "登录 QQ 空间",
    backgroundColor: "#ffffff",
    webPreferences: {
      session: qzoneSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedQqUrl(url)) void loginWindow?.loadURL(url);
    return { action: "deny" };
  });
  loginWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedQqUrl(url)) event.preventDefault();
  });
  loginWindow.once("ready-to-show", () => loginWindow?.show());

  loginPromise = new Promise((resolve, reject) => {
    let settled = false;
    let checking = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      reject(error);
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
    };
    const check = async () => {
      if (checking || settled) return;
      checking = true;
      try {
        const status = await inspectQzoneSession({ validate: true, account });
        if (status.authenticated) {
          const existingAccount = addAccount ? await findRegisteredAccountByUin(status.uin, account.id) : null;
          if (existingAccount) {
            const existingStatus = { ...status, accountId: existingAccount.id };
            await updateAccountFromStatus(existingAccount, existingStatus, { makeActive: true });
            await clearQzoneCookies(account.id, account);
            finish(publicSessionStatus(existingStatus));
          } else {
            await updateAccountFromStatus(account, status, { makeActive: true });
            finish(publicSessionStatus(status));
          }
          if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
        }
      } catch {
        // A transient cookie or validation failure should not close the login window.
      } finally {
        checking = false;
      }
    };
    timer = setInterval(check, 1200);
    loginWindow.on("closed", () => finish({ authenticated: false, uin: "", nickname: "", avatarUrl: "", accountLabel: "", accountId: "", cancelled: true }));
    loginWindow.webContents.on("did-navigate", check);
    loginWindow.webContents.on("did-navigate-in-page", check);
    loginWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      fail(new Error(`QQ 登录页加载失败：${errorDescription || validatedUrl}`));
    });
  }).finally(() => {
    loginWindow = null;
    loginPromise = null;
  });

  await loginWindow.loadURL(QZONE_HOME_URL).catch(() => undefined);
  return loginPromise;
}

async function addQzoneAccount(parentWindow) {
  const sessionStatus = await openQzoneLogin(parentWindow, { addAccount: true });
  return { ...(await listQzoneAccounts()), sessionStatus };
}

async function getActiveQzoneAccountId() {
  return (await resolveAccount()).id;
}

module.exports = {
  QZONE_PARTITION,
  QZONE_HOME_URL,
  addQzoneAccount,
  analyzeQzoneCookies,
  calculateGtk,
  clearQzoneCookies,
  deleteQzoneAccount,
  getActiveQzoneAccountId,
  getQzoneSession,
  getQzoneRequestContext,
  inspectQzoneSession,
  isAllowedQqUrl,
  listQzoneAccounts,
  openQzoneLogin,
  parseQzonePortraitResponse,
  publicSessionStatus,
  qzoneAvatarUrl,
  selectQzoneCookie,
  switchQzoneAccount,
  updateQzoneAccountProfile,
  validateQzoneSession,
};
