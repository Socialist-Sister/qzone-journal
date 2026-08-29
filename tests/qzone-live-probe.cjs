const path = require("node:path");
const { app, net, session } = require("electron");

function calculateGtk(value) {
  let hash = 5381;
  for (const char of String(value || "")) hash += (hash << 5) + char.charCodeAt(0);
  return hash & 0x7fffffff;
}

function parseJsonp(text) {
  const source = String(text || "").trim();
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

function structuralMask(value) {
  return Array.from(String(value || "")).map((character) => {
    if (character === "\r") return "\\r";
    if (character === "\n") return "\\n";
    if (/\s/.test(character)) return " ";
    if (/[{}[\]():,;'"\\.=<>/_&?-]/.test(character)) return character;
    if (/\d/.test(character)) return "0";
    return "a";
  }).join("");
}

function syntaxDiagnostic(body, response) {
  const source = String(body || "").trim();
  const open = source.indexOf("(");
  const close = source.lastIndexOf(")");
  const candidate = source.startsWith("{") || source.startsWith("[")
    ? source
    : open >= 0 && close > open ? source.slice(open + 1, close) : source;
  const repaired = candidate.replace(/\\x([0-9a-f]{2})/gi, "\\u00$1");
  let parseError = "";
  try {
    JSON.parse(repaired);
  } catch (error) {
    parseError = String(error?.message || error);
  }
  const position = Number(parseError.match(/position\s+(\d+)/i)?.[1] || 0);
  const contextStart = Math.max(0, position - 48);
  return {
    finalHost: (() => { try { return new URL(response.url).hostname; } catch { return ""; } })(),
    contentType: String(response.headers.get("content-type") || "").split(";", 1)[0],
    responseBytes: Buffer.byteLength(body),
    callbackWrapped: open >= 0 && close > open,
    hexEscapeCount: (candidate.match(/\\x[0-9a-f]{2}/gi) || []).length,
    unquotedKeyCount: (candidate.match(/(?:^|[{,])\s*[A-Za-z_$][\w$]*\s*:/g) || []).length,
    singleQuotedValueCount: (candidate.match(/:\s*'/g) || []).length,
    trailingCommaCount: (candidate.match(/,\s*[}\]]/g) || []).length,
    undefinedCount: (candidate.match(/\bundefined\b/g) || []).length,
    containsFeedId: /feed_\d+_\d+_/i.test(candidate),
    containsFeedData: /feed_data/i.test(candidate),
    repairedParseError: parseError,
    maskedErrorContext: structuralMask(repaired.slice(contextStart, Math.min(repaired.length, position + 96))),
  };
}

async function run() {
  const userDataPath = process.env.QZONE_JOURNAL_USER_DATA || path.join(process.env.APPDATA || "", "qzone-journal");
  app.setPath("userData", userDataPath);
  await app.whenReady();
  const qzoneSession = session.fromPartition("persist:qzone-journal-account", { cache: true });
  const cookies = await qzoneSession.cookies.get({});
  const byName = new Map(cookies.map((cookie) => [cookie.name, cookie.value]));
  const uin = String(byName.get("p_uin") || byName.get("uin") || byName.get("media_p_uin") || byName.get("ptui_loginuin") || "").replace(/\D/g, "");
  const qzoneSessionKeyCookie = cookies
    .filter((cookie) => cookie.name === "p_skey" && cookie.value)
    .sort((left, right) => Number(String(right.domain).includes("qzone.qq.com")) - Number(String(left.domain).includes("qzone.qq.com")))[0];
  const sessionKey = qzoneSessionKeyCookie?.value || "";
  if (!uin || !sessionKey) {
    const safeCookieSummary = cookies.map((cookie) => ({ name: cookie.name, domain: cookie.domain, secure: cookie.secure, session: cookie.session })).sort((a, b) => a.name.localeCompare(b.name));
    throw new Error(`没有找到可用的 QQ 空间登录会话；会话目录=${userDataPath}；Cookie=${JSON.stringify(safeCookieSummary)}`);
  }
  const params = new URLSearchParams({
    uin,
    scope: "1",
    view: "1",
    daylist: "",
    uinlist: "",
    gid: "",
    flag: "1",
    filter: "all",
    applist: "all",
    refresh: "1",
    aisortEndTime: "0",
    aisortOffset: "0",
    getAisort: "0",
    aisortBeginTime: "0",
    pagenum: "1",
    firstGetGroup: "0",
    icServerTime: "0",
    mixnocache: "0",
    scene: "0",
    begintime: "",
    dayspac: "5",
    sidomain: "qzonestyle.gtimg.cn",
    useutf8: "1",
    outputhtmlfeed: "1",
    rd: String(Math.random()),
    usertime: String(Date.now()),
    windowId: String(Math.random()),
    g_tk: String(calculateGtk(sessionKey)),
    format: "json",
    count: "10",
  });
  const url = `https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more?${params}`;
  const response = await net.fetch(url, {
    credentials: "include",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      referer: `https://user.qzone.qq.com/${uin}`,
    },
  });
  const body = await response.text();
  let payload;
  try {
    payload = parseJsonp(body);
  } catch {
    process.stdout.write(`${JSON.stringify({ authenticated: Boolean(byName.get("p_skey") || byName.get("skey")), accountLabel: `QQ ••••${uin.slice(-4)}`, httpStatus: response.status, syntax: syntaxDiagnostic(body, response) })}\n`);
    return;
  }
  const data = payload?.data?.data;
  const html = Array.isArray(data) ? data.map((item) => String(item?.html || "")).join("\n") : "";
  const summary = {
    authenticated: true,
    accountLabel: `QQ ••••${uin.slice(-4)}`,
    sessionKeyCookies: cookies
      .filter((cookie) => cookie.name === "p_skey" || cookie.name === "skey")
      .map((cookie) => ({ name: cookie.name, domain: cookie.domain, path: cookie.path, selectedByCurrentCode: cookie === qzoneSessionKeyCookie })),
    httpStatus: response.status,
    businessCode: payload?.code,
    businessMessage: String(payload?.message || payload?.msg || "").slice(0, 120),
    feedItems: Array.isArray(data) ? data.length : 0,
    responseBytes: Buffer.byteLength(body),
    mainKeys: Object.keys(payload?.data?.main || {}).sort(),
    hasMoreFeeds: payload?.data?.main?.hasMoreFeeds,
    hasExternparam: Boolean(payload?.data?.main?.externparam),
    structure: {
      feedDataTags: (html.match(/name=\\?"feed_data\\?"/g) || []).length,
      feedIds: (html.match(/id=\\?"feed_/g) || []).length,
      commentItems: (html.match(/comments-item/g) || []).length,
      likeMarkers: (html.match(/f-like|like-info|data-like/g) || []).length,
      imageTags: (html.match(/<img\b/g) || []).length,
    },
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

run()
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
