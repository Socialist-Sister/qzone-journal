const { net } = require("electron");
const { enrichFeeds3Cursor, isAuthenticationFailure, normalizeMediaUrl, parseFeeds3Page, parseMoodListPage } = require("./qzone-parser.cjs");

const QZONE_USER_URL = (uin) => `https://user.qzone.qq.com/${encodeURIComponent(uin)}`;
const FEEDS3_URL = "https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more";
const FEEDS3_PAGE_SIZE = 20;
const MOOD_LIST_URLS = [
  "https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6",
  "https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6",
];
const MOOD_PAGE_SIZE = 20;

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error("采集任务已取消"));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("采集任务已取消"));
    }, { once: true });
  });
}

function buildFeeds3Url({ uin, gTk, cursor = "", count = FEEDS3_PAGE_SIZE, scope = 1 }) {
  if (Number(scope) === 0) throw new Error("好友动态流不允许作为个人归档来源");
  // Checkpoints created by older builds can omit pagenum. Repair them before
  // the request so a later-page offset is never paired with pagenum=1.
  const requestCursor = enrichFeeds3Cursor(cursor);
  const cursorParams = new URLSearchParams(requestCursor);
  const params = new URLSearchParams({
    uin: String(uin),
    scope: "1",
    view: "1",
    daylist: "",
    uinlist: "",
    gid: "",
    flag: "1",
    filter: "all",
    applist: "all",
    refresh: requestCursor ? "0" : "1",
    aisortEndTime: "0",
    aisortOffset: "0",
    getAisort: "0",
    aisortBeginTime: "0",
    pagenum: cursorParams.get("pagenum") || "1",
    firstGetGroup: "0",
    icServerTime: "0",
    mixnocache: "0",
    scene: "0",
    begintime: cursorParams.get("basetime") || "",
    dayspac: "5",
    sidomain: "qzonestyle.gtimg.cn",
    useutf8: "1",
    outputhtmlfeed: "1",
    rd: String(Math.random()),
    usertime: String(Date.now()),
    windowId: String(Math.random()),
    g_tk: String(gTk),
    format: "json",
    count: String(count),
  });
  if (requestCursor) params.set("externparam", requestCursor);
  return `${FEEDS3_URL}?${params}`;
}

function buildMoodListUrl({ uin, gTk, cursor = "", count = MOOD_PAGE_SIZE, endpoint = MOOD_LIST_URLS[0] }) {
  const offset = Math.max(0, Number.parseInt(String(cursor || "0"), 10) || 0);
  const params = new URLSearchParams({
    uin: String(uin),
    ftype: "0",
    sort: "0",
    pos: String(offset),
    num: String(count),
    replynum: "100",
    g_tk: String(gTk),
    callback: "_preloadCallback",
    code_version: "1",
    format: "jsonp",
    need_private_comment: "1",
    _t: String(Date.now()),
  });
  return `${endpoint}?${params}`;
}

async function fetchMoodPageOnce({ uin, gTk, cursor = "", count = FEEDS3_PAGE_SIZE, signal, scope = 1 }, dependencies = {}) {
  const fetchRequest = dependencies.fetch || net.fetch;
  const delay = dependencies.delay || abortableDelay;
  let lastError;
  let cursorAuthRetryUsed = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // Rebuild the URL for every attempt so QQ receives fresh nonce fields.
      const url = buildFeeds3Url({ uin, gTk, cursor, count, scope });
      const response = await fetchRequest(url, {
        method: "GET",
        credentials: "include",
        redirect: "follow",
        signal,
        headers: {
          accept: "application/json, text/javascript, */*; q=0.01",
          "accept-language": "zh-CN,zh;q=0.9",
          referer: QZONE_USER_URL(uin),
          "x-requested-with": "XMLHttpRequest",
        },
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`说说接口请求失败（HTTP ${response.status}）`);
      let page;
      try {
        page = parseFeeds3Page(body, String(uin));
      } catch (error) {
        error.diagnostic = {
          httpStatus: response.status,
          finalHost: (() => { try { return new URL(response.url).hostname; } catch { return ""; } })(),
          contentType: String(response.headers.get("content-type") || "").split(";", 1)[0],
          responseBytes: Buffer.byteLength(body),
          parserCode: String(error?.code || "parse_failed"),
        };
        throw error;
      }
      if ((page.eligibleCount ?? page.rawCount) > 0 && page.entries.length === 0) throw new Error("QQ 空间返回了说说，但当前版本无法解析；已停止以避免生成空档案");
      return {
        ...page,
        adapter: "feeds3_personal",
        requestScope: 1,
        diagnostic: {
          adapter: "feeds3_personal",
          requestScope: 1,
          httpStatus: response.status,
          contentType: String(response.headers.get("content-type") || "").split(";", 1)[0],
          responseBytes: Buffer.byteLength(body),
          rawCount: page.rawCount,
          statusCount: page.statusCount,
          eligibleCount: page.eligibleCount,
          normalizedCount: page.entries.length,
          appidCounts: page.appidCounts,
          hasMore: page.hasMore,
        },
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isAuthenticationFailure(error?.code)) {
        const canRetryCursor = Number(error?.code) === -10001 && Boolean(cursor) && !cursorAuthRetryUsed;
        if (!canRetryCursor) throw error;
        cursorAuthRetryUsed = true;
        await delay(2200 + Math.floor(Math.random() * 600), signal);
        continue;
      }
      lastError = error;
      if (attempt < 2) await delay(700 * (attempt + 1) + Math.floor(Math.random() * 350), signal);
    }
  }
  throw lastError || new Error("说说接口请求失败");
}

async function fetchMoodCategoryPageOnce({ uin, gTk, cursor = "", count = MOOD_PAGE_SIZE, signal }, dependencies = {}) {
  const fetchRequest = dependencies.fetch || net.fetch;
  const delay = dependencies.delay || abortableDelay;
  let lastError;
  for (let attempt = 0; attempt < MOOD_LIST_URLS.length; attempt += 1) {
    try {
      const url = buildMoodListUrl({ uin, gTk, cursor, count, endpoint: MOOD_LIST_URLS[attempt] });
      const response = await fetchRequest(url, {
        method: "GET",
        credentials: "include",
        redirect: "follow",
        signal,
        headers: {
          accept: "application/json, text/javascript, */*; q=0.01",
          "accept-language": "zh-CN,zh;q=0.9",
          referer: `${QZONE_USER_URL(uin)}/311`,
          "x-requested-with": "XMLHttpRequest",
        },
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`说说分类接口请求失败（HTTP ${response.status}）`);
      let page;
      try {
        page = parseMoodListPage(body, String(uin), { offset: Number(cursor) || 0, count });
      } catch (error) {
        error.diagnostic = {
          adapter: "mood_list",
          httpStatus: response.status,
          finalHost: (() => { try { return new URL(response.url).hostname; } catch { return ""; } })(),
          contentType: String(response.headers.get("content-type") || "").split(";", 1)[0],
          responseBytes: Buffer.byteLength(body),
          parserCode: String(error?.code || "parse_failed"),
        };
        throw error;
      }
      if (page.rawCount > 0 && page.entries.length === 0) throw new Error("QQ 空间返回了说说，但当前版本无法解析；已停止以避免生成空档案");
      return {
        ...page,
        diagnostic: {
          adapter: "mood_list",
          httpStatus: response.status,
          contentType: String(response.headers.get("content-type") || "").split(";", 1)[0],
          responseBytes: Buffer.byteLength(body),
          rawCount: page.rawCount,
          statusCount: page.statusCount,
          eligibleCount: page.eligibleCount,
          normalizedCount: page.entries.length,
          total: page.total,
          offset: page.offset,
          hasMore: page.hasMore,
        },
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isAuthenticationFailure(error?.code)) throw error;
      lastError = error;
      if (attempt < MOOD_LIST_URLS.length - 1) await delay(850 + Math.floor(Math.random() * 300), signal);
    }
  }
  throw lastError || new Error("说说分类接口请求失败");
}

async function fetchMoodPage(options, dependencies = {}) {
  if (options.adapter === "feeds3_personal") {
    return fetchMoodPageOnce({ ...options, scope: 1 }, dependencies);
  }
  try {
    return await fetchMoodCategoryPageOnce(options, dependencies);
  } catch (error) {
    const canResetStaleCursor = Boolean(
      options.resetStaleCursor
      && options.cursor
      && isAuthenticationFailure(error?.code),
    );
    if (canResetStaleCursor) {
      const restarted = await fetchMoodCategoryPageOnce({ ...options, cursor: "", resetStaleCursor: false }, dependencies);
      restarted.resumeCursorReset = true;
      restarted.diagnostic = {
        ...(restarted.diagnostic || {}),
        resumeCursorReset: true,
        rejectedCursorCode: String(error.code),
      };
      return restarted;
    }
    if (error?.code !== "QZONE_MOOD_RATE_LIMITED" || options.cursor) throw error;
    const fallback = await fetchMoodPageOnce({ ...options, cursor: "", scope: 1 }, dependencies);
    fallback.diagnostic = {
      ...(fallback.diagnostic || {}),
      categoryRateLimited: true,
      categoryBusinessCode: String(error.businessCode || -10000),
    };
    return fallback;
  }
}

async function downloadMedia({ sourceUrl, uin, signal }) {
  const safeUrl = normalizeMediaUrl(sourceUrl);
  if (!safeUrl) throw new Error("媒体地址不在 QQ 空间允许列表中");
  const variants = [
    { credentials: "include", referer: QZONE_USER_URL(uin) },
    { credentials: "omit", referer: "https://user.qzone.qq.com/" },
  ];
  let lastError;
  for (const variant of variants) {
    try {
      const response = await net.fetch(safeUrl, {
        method: "GET",
        credentials: variant.credentials,
        redirect: "follow",
        signal,
        headers: {
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          referer: variant.referer,
        },
      });
      if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
      const contentType = String(response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
      if (!contentType.startsWith("image/")) throw new Error(`媒体响应类型异常：${contentType}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error("图片响应为空");
      if (bytes.length > 80 * 1024 * 1024) throw new Error("单张图片超过 80 MB 安全限制");
      return { bytes, contentType, finalUrl: response.url || safeUrl };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("图片下载失败");
}

async function probeSession({ uin, signal }) {
  const response = await net.fetch(QZONE_USER_URL(uin), {
    method: "GET",
    credentials: "include",
    redirect: "follow",
    signal,
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  const finalUrl = response.url || QZONE_USER_URL(uin);
  const finalHost = new URL(finalUrl).hostname;
  if (!response.ok) throw new Error(`QQ 空间会话检查失败（HTTP ${response.status}）`);
  if (finalHost.includes("ptlogin") || finalHost.includes("xui.ptlogin2")) throw new Error("QQ 登录会话已失效，请重新扫码登录");
  return {
    ok: true,
    status: response.status,
    finalHost,
    checkedAt: new Date().toISOString(),
  };
}

function createCollectionPlan(options) {
  return options.items.map((item) => ({
    id: item,
    status: item === "albums" ? "deferred" : "ready",
    description: item === "posts" ? "说说正文与配图" : item === "albums" ? "相册与媒体" : item === "comments" ? "评论与回复" : "点赞记录",
  }));
}

module.exports = { FEEDS3_PAGE_SIZE, MOOD_PAGE_SIZE, abortableDelay, buildFeeds3Url, buildMoodListUrl, createCollectionPlan, downloadMedia, fetchMoodCategoryPageOnce, fetchMoodPage, fetchMoodPageOnce, probeSession };
