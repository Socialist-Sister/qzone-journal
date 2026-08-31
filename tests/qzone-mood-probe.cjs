const fs = require("node:fs/promises");
const path = require("node:path");
const { app, net, session } = require("electron");

function calculateGtk(value) {
  let hash = 5381;
  for (const character of String(value || "")) hash += (hash << 5) + character.charCodeAt(0);
  return hash & 0x7fffffff;
}

function parseJsonp(text) {
  const source = String(text || "").replace(/^\uFEFF/, "").trim();
  const parse = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return JSON.parse(candidate.replace(/\\x([0-9a-f]{2})/gi, "\\u00$1"));
    }
  };
  if (source.startsWith("{") || source.startsWith("[")) return parse(source);
  const start = source.indexOf("(");
  const end = source.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("响应不是可识别的 JSON/JSONP");
  return parse(source.slice(start + 1, end));
}

function cookieScore(cookie) {
  const domain = String(cookie?.domain || "").replace(/^\./, "").toLowerCase();
  if (domain === "user.qzone.qq.com") return 4;
  if (domain.endsWith(".qzone.qq.com") || domain === "qzone.qq.com") return 3;
  if (domain === "qq.com") return 2;
  return domain.endsWith(".qq.com") ? 1 : 0;
}

function selectCookie(cookies, name) {
  return cookies
    .filter((cookie) => cookie.name === name && cookie.value)
    .sort((left, right) => cookieScore(right) - cookieScore(left))[0];
}

async function activePartition(userDataPath) {
  try {
    const registry = JSON.parse(await fs.readFile(path.join(userDataPath, "qzone-accounts.json"), "utf8"));
    const active = registry.accounts?.find((account) => account.id === registry.activeAccountId) || registry.accounts?.[0];
    if (active?.partition) return active.partition;
  } catch {
    // The original account predates the registry.
  }
  return "qzone-journal-account";
}

async function run() {
  const userDataPath = process.env.QZONE_JOURNAL_USER_DATA || path.join(process.env.APPDATA || "", "qzone-journal");
  app.setPath("userData", userDataPath);
  await app.whenReady();
  const partition = await activePartition(userDataPath);
  const qzoneSession = session.fromPartition(partition, { cache: true });
  const cookies = await qzoneSession.cookies.get({});
  const uin = String(selectCookie(cookies, "p_uin")?.value || selectCookie(cookies, "uin")?.value || "").replace(/\D/g, "");
  const sessionKey = selectCookie(cookies, "p_skey")?.value || "";
  if (!uin || !sessionKey) throw new Error("当前账号没有可用的 QQ 空间会话，请先在应用中扫码登录");

  const params = new URLSearchParams({
    uin,
    ftype: "0",
    sort: "0",
    pos: "0",
    num: "20",
    replynum: "100",
    g_tk: String(calculateGtk(sessionKey)),
    callback: "_preloadCallback",
    code_version: "1",
    format: "jsonp",
    need_private_comment: "1",
  });
  const url = `https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6?${params}`;
  const response = await net.fetch(url, {
    method: "GET",
    credentials: "include",
    redirect: "follow",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      referer: `https://user.qzone.qq.com/${uin}/311`,
      "x-requested-with": "XMLHttpRequest",
    },
  });
  const body = await response.text();
  const payload = parseJsonp(body);
  const messages = Array.isArray(payload?.msglist) ? payload.msglist : [];
  const first = messages[0] && typeof messages[0] === "object" ? messages[0] : {};
  const firstPicture = Array.isArray(first.pic) && first.pic[0] && typeof first.pic[0] === "object" ? first.pic[0] : {};
  const firstComment = Array.isArray(first.commentlist) && first.commentlist[0] && typeof first.commentlist[0] === "object" ? first.commentlist[0] : {};
  process.stdout.write(`${JSON.stringify({
    accountLabel: `QQ ••••${uin.slice(-4)}`,
    partition: partition.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<account>"),
    httpStatus: response.status,
    finalHost: (() => { try { return new URL(response.url).hostname; } catch { return ""; } })(),
    contentType: String(response.headers.get("content-type") || "").split(";", 1)[0],
    responseBytes: Buffer.byteLength(body),
    code: payload?.code,
    messageCount: messages.length,
    payloadKeys: Object.keys(payload || {}).sort(),
    messageKeys: Object.keys(first).sort(),
    pictureKeys: Object.keys(firstPicture).sort(),
    commentKeys: Object.keys(firstComment).sort(),
    hasMore: payload?.hasmore ?? payload?.has_more,
    total: payload?.total ?? payload?.total_count,
  })}\n`);
}

run()
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
