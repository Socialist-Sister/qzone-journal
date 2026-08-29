function parseQzoneJson(candidate) {
  try {
    return JSON.parse(candidate);
  } catch (strictError) {
    // feeds3 embeds HTML with JavaScript-style \xHH escapes even when format=json.
    // Convert only that bounded escape form to valid JSON unicode escapes; never eval upstream text.
    const repaired = candidate.replace(/\\x([0-9a-f]{2})/gi, "\\u00$1");
    if (repaired !== candidate) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Fall through to a stable user-facing error below.
      }
    }
    const error = new Error("QQ 空间返回的数据格式异常，已安全停止本次采集；请重新扫码后再试");
    error.code = "QZONE_RESPONSE_FORMAT";
    error.cause = strictError;
    throw error;
  }
}

function parseJsonp(text) {
  const source = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!source) throw new Error("QQ 空间接口返回了空响应");
  if (source.startsWith("{") || source.startsWith("[")) return parseQzoneJson(source);
  const start = source.indexOf("(");
  const end = source.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("QQ 空间接口返回了无法识别的响应");
  return parseQzoneJson(source.slice(start + 1, end));
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function decodeEscapedHtml(value) {
  return decodeHtmlEntities(String(value || "")
    .replace(/\\x22/gi, '"')
    .replace(/\\x27/gi, "'")
    .replace(/\\x3c/gi, "<")
    .replace(/\\x3e/gi, ">")
    .replace(/\\x26/gi, "&")
    .replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\\//g, "/"));
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attribute(source, name) {
  const match = String(source || "").match(new RegExp(`(?:data-)?${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? decodeHtmlEntities(match[1]) : "";
}

function normalizeMediaUrl(value) {
  let candidate = decodeHtmlEntities(String(value || "").trim());
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  if (candidate.startsWith("http://")) candidate = `https://${candidate.slice(7)}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:") return "";
    const host = parsed.hostname.toLowerCase();
    const allowed = host.endsWith("qpic.cn")
      || host.includes("photo.store.qq.com")
      || host.endsWith("photo.qq.com")
      || host.endsWith("qzone.qq.com");
    if (!allowed || host.includes("qlogo")) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function extractMedia(html) {
  const postHtml = String(html || "").split(/<[^>]+class=["'][^"']*mod-comments[^"']*["']/i)[0];
  const media = new Map();
  const add = (url, kind = "image") => {
    const normalized = normalizeMediaUrl(url);
    if (normalized && !media.has(normalized)) media.set(normalized, { kind, sourceUrl: normalized });
  };
  // data-pickey points at the original photo while the nested img src is a
  // rendered thumbnail of the same photo. Prefer originals for the whole post.
  for (const match of postHtml.matchAll(/data-pickey=["'][^,"']+,([^"']+)["']/gi)) add(match[1]);
  if (media.size) return [...media.values()];
  for (const match of postHtml.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (/avatar|qlogo|emoji|emoticon|icon/gi.test(attrs) && !/img-item|photo|qpic/gi.test(attrs)) continue;
    add(attribute(attrs, "original") || attribute(attrs, "trueSrc") || attribute(attrs, "src") || attribute(attrs, "url"));
  }
  return [...media.values()];
}

function parseComments(html) {
  const source = String(html || "");
  const starts = [...source.matchAll(/<li\b([^>]*class=["'][^"']*comments-item[^"']*["'][^>]*)>/gi)];
  return starts.map((match, index) => {
    const attrs = match[1];
    const end = starts[index + 1]?.index ?? Math.min(source.length, match.index + 6000);
    const body = source.slice(match.index + match[0].length, end);
    const name = attribute(attrs, "nick") || stripHtml(body.match(/class=["'][^"']*nickname[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || "") || "QQ 用户";
    const contentHtml = body.match(/class=["'][^"']*comments-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
    let text = stripHtml(contentHtml);
    if (text.startsWith(name)) text = text.slice(name.length).replace(/^\s*(?:回复\s+[^:：]+)?\s*[:：]\s*/, "").trim();
    return {
      id: attribute(attrs, "tid") || `${index + 1}`,
      authorUin: attribute(attrs, "uin"),
      name,
      text,
      isReply: attribute(attrs, "type") === "replyroot",
      source: "feeds3_html",
    };
  }).filter((comment) => comment.text || comment.name !== "QQ 用户");
}

function extractLikePeople(html) {
  const source = String(html || "");
  const regions = [];
  for (const marker of source.matchAll(/class=["'][^"']*(?:mod-like|like-info|f-like-list|like-list)[^"']*["']/gi)) {
    const start = Math.max(0, marker.index - 300);
    const commentsStart = source.indexOf("mod-comments", marker.index);
    const end = commentsStart >= 0 ? Math.min(commentsStart, marker.index + 5000) : Math.min(source.length, marker.index + 5000);
    regions.push(source.slice(start, end));
  }
  const people = new Map();
  for (const region of regions) {
    for (const match of region.matchAll(/<a\b([^>]*(?:nameCard_|data-uin)[^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = match[1];
      const uin = attrs.match(/nameCard_(\d+)/i)?.[1] || attribute(attrs, "uin");
      const name = stripHtml(match[2]);
      if (uin && name && !people.has(uin)) people.set(uin, { uin, name, source: "feeds3_html" });
    }
  }
  return [...people.values()];
}

function numberFromPatterns(source, patterns) {
  for (const pattern of patterns) {
    const match = String(source || "").match(pattern);
    if (match) return Number(match[1]) || 0;
  }
  return 0;
}

function feedIdentity(rawItem) {
  const html = decodeEscapedHtml(rawItem?.html || "");
  const feedData = html.match(/name=["']feed_data["']\s*([^>]*)>/i)?.[1] || "";
  const feedId = html.match(/id=["']feed_(\d+)_(\d+)_(\d+)_(\d+)_\d+_\d+["']/i);
  return {
    html,
    feedData,
    feedId,
    authorUin: attribute(feedData, "uin") || String(rawItem?.opuin || feedId?.[1] || ""),
    appid: String(rawItem?.appid || feedId?.[2] || ""),
  };
}

function summarizeFeedItems(rawItems, ownerUin) {
  const appidCounts = {};
  let statusCount = 0;
  let eligibleCount = 0;
  for (const rawItem of rawItems) {
    const identity = feedIdentity(rawItem);
    const appid = identity.appid || "unknown";
    appidCounts[appid] = (appidCounts[appid] || 0) + 1;
    if (appid !== "311") continue;
    statusCount += 1;
    if (!ownerUin || !identity.authorUin || identity.authorUin === String(ownerUin)) eligibleCount += 1;
  }
  return { appidCounts, statusCount, eligibleCount };
}

function parseFeedItem(rawItem, ownerUin) {
  const { html, feedData, feedId, authorUin, appid } = feedIdentity(rawItem);
  if (ownerUin && authorUin && authorUin !== String(ownerUin)) return null;
  if (appid !== "311") return null;
  const sourceId = attribute(feedData, "tid")
    || attribute(feedData, "origtid")
    || String(rawItem?.key || rawItem?.fkey || "");
  if (!sourceId) return null;
  const feedDataIndex = html.search(/name=["']feed_data["']/i);
  const before = feedDataIndex >= 0 ? html.slice(0, feedDataIndex) : html;
  const after = feedDataIndex >= 0 ? html.slice(feedDataIndex) : html;
  const fInfoBefore = [...before.matchAll(/class=["'][^"']*\bf-info\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].at(-1)?.[1];
  const txtBoxBefore = [...before.matchAll(/<(p|div)\b[^>]*class=["'][^"']*\btxt-box(?:-title)?\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi)].at(-1)?.[2];
  const txtBoxAfter = after.match(/<(p|div)\b[^>]*class=["'][^"']*\btxt-box(?:-title)?\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  const fallbackContent = html.match(/class=["'][^"']*\bf-info\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  let text = [fInfoBefore, txtBoxBefore, txtBoxAfter, fallbackContent].map(stripHtml).find(Boolean) || "";
  const nickname = String(rawItem?.nickname || stripHtml(html.match(/class=["']f-name[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || ""));
  if (nickname && text.startsWith(`${nickname}：`)) text = text.slice(nickname.length + 1).trim();
  const createdSeconds = Number(attribute(feedData, "abstime") || rawItem?.abstime || rawItem?.created_time || feedId?.[4] || 0);
  const comments = parseComments(html);
  const likes = extractLikePeople(html);
  const commentCount = numberFromPatterns(html, [
    /data-cmtnum=["'](\d+)["']/i,
    /cmtnum["']?\s*[=:]\s*["']?(\d+)/i,
    /class=["'][^"']*f-ct[^"']*["'][^>]*>\s*(\d+)/i,
  ]) || comments.length;
  const likeCount = numberFromPatterns(html, [
    /data-likecount=["'](\d+)["']/i,
    /data-likecnt=["'](\d+)["']/i,
    /likenum["']?\s*[=:]\s*["']?(\d+)/i,
    /class=["']f-like-cnt["'][^>]*>\s*(\d+)/i,
  ]) || likes.length;
  const media = extractMedia(html);
  if (!text && !media.length) return null;
  return {
    sourceId,
    type: "post",
    createdAt: createdSeconds > 0 ? new Date(createdSeconds * 1000).toISOString() : "",
    title: null,
    text,
    media,
    comments,
    likes,
    metrics: { commentCount, likeCount },
    sourceMeta: { adapter: "feeds3_html_more", parserVersion: 3, appid, authorNickname: nickname },
  };
}

function truthyMore(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function firstRawField(source, name) {
  const match = String(source || "").match(new RegExp(`(?:["']?${name}["']?)\\s*[:=]\\s*["']([^"']*)["']`, "i"));
  return match ? decodeHtmlEntities(match[1]) : "";
}

function enrichFeeds3Cursor(cursor, currentPage = 0) {
  const value = String(cursor || "");
  if (!value) return "";
  const params = new URLSearchParams(value);
  if (params.has("pagenum")) return value;
  const offset = Number(params.get("offset") || 0);
  const nextPage = Number(currentPage) > 0
    ? Number(currentPage) + 1
    : offset > 0 ? Math.floor(offset / 10) + 1 : 2;
  return `${value}${value.endsWith("&") ? "" : "&"}pagenum=${nextPage}`;
}

function parseRawFeeds3Page(text, ownerUin) {
  const decoded = decodeEscapedHtml(text);
  const starts = [...decoded.matchAll(/<(?:div|li)\b[^>]*\bid\s*=\s*["']feed_(\d+)_(\d+)_\d+_(\d+)_\d+_\d+["'][^>]*>/gi)];
  const rawItems = starts.map((match, index) => {
    const end = starts[index + 1]?.index ?? decoded.length;
    const html = decoded.slice(match.index, end);
    return {
      html,
      opuin: match[1],
      appid: match[2],
      abstime: match[3],
      key: attribute(match[0], "key"),
    };
  });
  const entries = rawItems.map((item) => parseFeedItem(item, ownerUin)).filter(Boolean);
  const summary = summarizeFeedItems(rawItems, ownerUin);
  const hasMoreMatch = decoded.match(/(?:["']?hasMoreFeeds["']?)\s*[:=]\s*["']?(true|false|1|0)/i);
  const pageMatch = decoded.match(/(?:["']?pagenum["']?)\s*[:=]\s*["']?(\d+)/i);
  const pageNumber = Number(pageMatch?.[1]) || 0;
  return {
    entries,
    rawCount: rawItems.length,
    ...summary,
    hasMore: hasMoreMatch ? truthyMore(hasMoreMatch[1]) : Boolean(firstRawField(decoded, "externparam")),
    cursor: enrichFeeds3Cursor(firstRawField(decoded, "externparam"), pageNumber),
    pageNumber,
  };
}

function rawBusinessFailure(text) {
  const header = String(text || "").slice(0, 1200);
  const codeMatch = header.match(/(?:["']?code["']?)\s*[:=]\s*["']?(-?\d+)/i);
  if (!codeMatch) return null;
  const code = Number(codeMatch[1]);
  if (!Number.isFinite(code) || code === 0) return null;
  return { code, message: firstRawField(header, "message") || firstRawField(header, "msg") };
}

function isAuthenticationFailure(code) {
  return [-3, -100, -3000, -10001, -10006].includes(Number(code));
}

function parseFeeds3Page(text, ownerUin) {
  let payload;
  try {
    payload = parseJsonp(text);
  } catch (parseError) {
    const failure = rawBusinessFailure(text);
    if (failure) {
      const error = new Error(isAuthenticationFailure(failure.code)
        ? "QQ 登录会话已失效，请重新扫码登录"
        : `QQ 空间接口错误 ${failure.code}：${failure.message || "请求失败"}`);
      error.code = failure.code;
      throw error;
    }
    const rawPage = parseRawFeeds3Page(text, ownerUin);
    if (rawPage.rawCount > 0 || /(?:["']?code["']?)\s*[:=]\s*["']?0\b/i.test(String(text || "").slice(0, 1200))) return rawPage;
    throw parseError;
  }
  const code = Number(payload?.code ?? -1);
  if (code !== 0) {
    const message = String(payload?.message || payload?.msg || "QQ 空间接口返回失败");
    const error = new Error(isAuthenticationFailure(code) ? "QQ 登录会话已失效，请重新扫码登录" : `QQ 空间接口错误 ${code}：${message}`);
    error.code = code;
    throw error;
  }
  const rawItems = Array.isArray(payload?.data?.data) ? payload.data.data : [];
  const entries = rawItems.map((item) => parseFeedItem(item, ownerUin)).filter(Boolean);
  const summary = summarizeFeedItems(rawItems, ownerUin);
  const main = payload?.data?.main && typeof payload.data.main === "object" ? payload.data.main : {};
  let cursor = typeof main.externparam === "string" ? decodeHtmlEntities(main.externparam) : "";
  cursor = enrichFeeds3Cursor(cursor, Number(main.pagenum) || 0);
  return {
    entries,
    rawCount: rawItems.length,
    ...summary,
    hasMore: truthyMore(main.hasMoreFeeds),
    cursor,
    pageNumber: Number(main.pagenum) || 0,
  };
}

module.exports = {
  decodeEscapedHtml,
  decodeHtmlEntities,
  enrichFeeds3Cursor,
  isAuthenticationFailure,
  normalizeMediaUrl,
  parseComments,
  parseFeedItem,
  parseFeeds3Page,
  parseJsonp,
  parseRawFeeds3Page,
  stripHtml,
};
