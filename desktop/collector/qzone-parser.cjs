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

function normalizeQzoneMentions(value) {
  const source = String(value || "");
  return source.replace(/@\{([^{}\r\n]*)\}/g, (match, fields, offset) => {
    const nickname = String(fields)
      .match(/(?:^|,)\s*nick\s*:\s*([\s\S]*?)(?=,\s*(?:uin|who|auto)\s*:|$)/i)?.[1]
      ?.trim();
    const nextCharacter = source.slice(offset + match.length, offset + match.length + 1);
    const needsSpace = Boolean(nextCharacter) && !/[\s,，.。!?！？:：;；、)）\]】}]/.test(nextCharacter);
    return `${nickname ? `@${nickname}` : "@QQ好友"}${needsSpace ? " " : ""}`;
  });
}

function stripHtml(value) {
  const plainText = decodeHtmlEntities(String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
  return normalizeQzoneMentions(plainText)
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attribute(source, name) {
  const match = String(source || "").match(new RegExp(`(?:data-)?${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? decodeHtmlEntities(match[1]) : "";
}

function hostMatches(host, allowedHost) {
  return host === allowedHost || host.endsWith(`.${allowedHost}`);
}

function normalizeMediaUrl(value) {
  let candidate = decodeHtmlEntities(String(value || "").trim());
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  if (candidate.startsWith("http://")) candidate = `https://${candidate.slice(7)}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return "";
    const host = parsed.hostname.toLowerCase();
    const allowed = hostMatches(host, "qpic.cn")
      || hostMatches(host, "photo.store.qq.com")
      || hostMatches(host, "photo.qq.com")
      || hostMatches(host, "qzone.qq.com");
    if (!allowed || host.includes("qlogo")) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeExternalUrl(value) {
  let candidate = decodeHtmlEntities(String(value || "").trim());
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  if (candidate.startsWith("http://")) candidate = `https://${candidate.slice(7)}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return "";
    const host = parsed.hostname.toLowerCase();
    if (hostMatches(host, "qpic.cn") || hostMatches(host, "photo.store.qq.com") || hostMatches(host, "photo.qq.com")) return "";
    if (host === "c.pc.qq.com" || host === "url.cn") {
      for (const name of ["pfurl", "url", "target"]) {
        const nested = parsed.searchParams.get(name);
        if (nested) {
          const normalized = normalizeExternalUrl(nested);
          if (normalized && !new URL(normalized).hostname.toLowerCase().endsWith("qq.com")) return normalized;
        }
      }
    }
    if (host.endsWith("qq.com") || host.endsWith("gtimg.cn") || host === "url.cn") return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function collectObjectUrls(value, result = new Map(), depth = 0) {
  if (depth > 6 || result.size >= 20 || value == null) return result;
  if (typeof value === "string") {
    for (const match of decodeHtmlEntities(value).matchAll(/https?:\/\/[^\s<>"'\\]+/gi)) {
      const url = normalizeExternalUrl(match[0]);
      if (!url || result.has(url)) continue;
      let label = "外部链接";
      try { label = new URL(url).hostname; } catch { /* Already normalized. */ }
      result.set(url, { url, label });
      if (result.size >= 20) break;
    }
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectObjectUrls(item, result, depth + 1);
    return result;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectObjectUrls(item, result, depth + 1);
  }
  return result;
}

function videoDimensions(video, fallback = {}) {
  return {
    width: Number(video?.width || video?.w || fallback?.width || fallback?.w || 0) || undefined,
    height: Number(video?.height || video?.h || fallback?.height || fallback?.h || 0) || undefined,
  };
}

function emotionMedia(rawItem) {
  const containers = [rawItem, rawItem?.rt_con].filter(Boolean);
  const aliases = new Map();
  const videoRecords = new WeakMap();
  const pictureUrls = (picture) => [picture?.url1, picture?.url3, picture?.url2, picture?.url, picture?.pic_url].map(normalizeMediaUrl).filter(Boolean);
  const registerVideo = (video, fallback = {}) => {
    if (!video || typeof video !== "object") return;
    const sourceUrl = [video.url3, video.video_url, video.videoUrl, video.play_url, video.playUrl, video.url].map(normalizeMediaUrl).find(Boolean) || "";
    const posterUrls = [video.pic_url, video.cover_url, video.coverUrl, video.url1, video.thumbnailUrl, ...pictureUrls(fallback)]
      .map(normalizeMediaUrl).filter((url) => url && url !== sourceUrl);
    if (!sourceUrl && !posterUrls.length) return;
    const videoId = String(video.video_id || video.videoId || video.vid || fallback.video_id || "").slice(0, 200);
    const keys = [videoId && `id:${videoId}`, sourceUrl, ...posterUrls].filter(Boolean);
    const previous = keys.map((key) => aliases.get(key)).find(Boolean);
    const record = previous || { kind: "video", sourceUrl: "", posterSourceUrl: "" };
    record.sourceUrl ||= sourceUrl;
    record.posterSourceUrl ||= posterUrls[0] || "";
    record.videoId ||= videoId || undefined;
    record.durationMs ||= Number(video.duration || video.duration_ms || video.durationMs || 0) || undefined;
    const dimensions = videoDimensions(video, fallback);
    record.width ||= dimensions.width;
    record.height ||= dimensions.height;
    for (const key of keys) aliases.set(key, record);
    videoRecords.set(video, record);
  };
  // Register all aliases first: pic[] may contain only a thumbnail while video[]
  // holds the playable source. A video replaces its cover in that exact pic slot.
  for (const container of containers) {
    for (const video of Array.isArray(container.video) ? container.video : []) registerVideo(video);
    for (const picture of Array.isArray(container.pic) ? container.pic : []) registerVideo(picture?.video_info, picture);
  }
  const media = [];
  const seen = new Set();
  const emit = (item) => {
    if (!item) return;
    const key = item.kind === "video" ? item : item.sourceUrl;
    if (seen.has(key)) return;
    seen.add(key);
    media.push(item);
  };
  for (const container of containers) {
    for (const picture of Array.isArray(container.pic) ? container.pic : []) {
      if (!picture || typeof picture !== "object") continue;
      const urls = pictureUrls(picture);
      const video = videoRecords.get(picture.video_info) || urls.map((url) => aliases.get(url)).find(Boolean);
      if (video) emit(video);
      else if (!picture.video_info && urls.length) emit({ kind: "image", sourceUrl: urls[0], ...videoDimensions(picture) });
    }
    // Video-only posts and APIs without cover slots still retain all native videos.
    for (const video of Array.isArray(container.video) ? container.video : []) emit(videoRecords.get(video));
  }
  return media;
}

function emotionComments(rawItem) {
  const comments = [];
  const append = (items, parentId = null) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== "object") continue;
      const text = stripHtml(item.content || item.con || "");
      const id = String(item.tid || item.id || `${comments.length + 1}`);
      if (text || item.name || item.nickname) {
        comments.push({
          id,
          authorUin: String(item.uin || item.fuin || ""),
          authorName: stripHtml(item.name || item.nickname || "") || "QQ 用户",
          text,
          isReply: Boolean(parentId),
          parentId,
          createdAt: String(item.createTime2 || item.created_time || item.create_time || ""),
          source: "emotion_msglist_v6",
        });
      }
      append(item.list_3 || item.replylist || item.replies, id);
    }
  };
  append(rawItem?.commentlist);
  return comments.slice(0, 1000);
}

function emotionLikes(rawItem) {
  const candidates = [rawItem?.like_uin_info, rawItem?.likelist, rawItem?.__like]
    .find(Array.isArray) || [];
  const people = new Map();
  for (const item of candidates) {
    const uin = String(item?.fuin || item?.uin || "");
    const name = stripHtml(item?.nick || item?.name || item?.nickname || "");
    if (uin && name && !people.has(uin)) people.set(uin, { uin, name, source: "emotion_msglist_v6" });
  }
  return [...people.values()];
}

function firstReportedCount(...values) {
  for (const value of values) {
    if (value === "" || value === null || value === undefined) continue;
    const count = Number(value);
    if (Number.isFinite(count) && count >= 0) return { count, reported: true };
  }
  return { count: 0, reported: false };
}

function parseLikeListPage(text, { count = 60 } = {}) {
  const payload = parseJsonp(text);
  const code = Number(payload?.code ?? payload?.ret ?? 0);
  if (code !== 0) {
    const message = String(payload?.message || payload?.msg || "QQ 点赞名单接口返回失败");
    const error = new Error(isAuthenticationFailure(code)
      ? "QQ 登录会话已失效，请重新扫码登录"
      : [-10000, -2].includes(code)
        ? "QQ 点赞名单接口请求过于频繁，已保存进度"
        : "QQ 点赞名单接口错误 " + code + "：" + message);
    error.code = isAuthenticationFailure(code) ? code : [-10000, -2].includes(code) ? "QZONE_INTERACTION_RATE_LIMITED" : code;
    error.businessCode = code;
    throw error;
  }
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const candidates = [data?.like_uin_info, data?.likelist, data?.items, data?.list]
    .find(Array.isArray) || [];
  const people = new Map();
  for (const item of candidates.slice(0, 3000)) {
    if (!item || typeof item !== "object") continue;
    const uin = String(item.fuin || item.uin || item.user_uin || "");
    const name = stripHtml(item.nick || item.nickname || item.name || "");
    if (!name) continue;
    const key = uin || "name:" + name;
    if (!people.has(key)) people.set(key, { uin, name, source: "qzone_like_list" });
  }
  const totalResult = firstReportedCount(
    data?.total_number,
    data?.total,
    data?.like_count,
    data?.count,
    payload?.total_number,
    payload?.total,
  );
  const explicitMore = data?.has_more ?? data?.hasmore ?? data?.is_more;
  const lastPerson = candidates.at(-1);
  const nextCursor = String(data?.next_uin || data?.last_uin || lastPerson?.fuin || lastPerson?.uin || "");
  const pageSize = Math.max(1, Number(count) || 60);
  const hasMore = explicitMore == null
    ? totalResult.reported
      ? people.size > 0 && people.size < totalResult.count && candidates.length >= pageSize
      : candidates.length >= pageSize
    : truthyMore(explicitMore);
  return {
    likes: [...people.values()],
    total: Math.max(people.size, totalResult.count),
    hasMore: Boolean(hasMore && nextCursor),
    nextCursor,
  };
}

function parseEmotionItem(rawItem, ownerUin) {
  const authorUin = String(rawItem?.uin || rawItem?.opuin || "");
  if (ownerUin && authorUin && authorUin !== String(ownerUin)) return null;
  const sourceId = String(rawItem?.tid || rawItem?.cur_key || rawItem?.key || "").trim();
  if (!sourceId) return null;
  const ownText = stripHtml(rawItem?.content || rawItem?.con || "");
  const forwardedText = stripHtml(rawItem?.rt_con?.content || rawItem?.rt_con?.con || "");
  const text = [ownText, forwardedText && forwardedText !== ownText ? `转发内容：${forwardedText}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const media = emotionMedia(rawItem);
  const links = [...collectObjectUrls(rawItem).values()];
  if (!text && !media.length && !links.length) return null;
  const comments = emotionComments(rawItem);
  const likes = emotionLikes(rawItem);
  const commentMetric = firstReportedCount(rawItem?.cmtnum, rawItem?.commentnum, rawItem?.comment_count);
  const likeMetric = firstReportedCount(rawItem?.likenum, rawItem?.likecount, rawItem?.like_count, rawItem?.praiseCount);
  const createdSeconds = Number(rawItem?.created_time || rawItem?.createTime?.time || rawItem?.create_time || 0);
  const originalAuthorUin = String(rawItem?.rt_uin || rawItem?.rt_con?.uin || "");
  return {
    sourceId,
    type: "post",
    createdAt: createdSeconds > 0 ? new Date(createdSeconds * 1000).toISOString() : "",
    title: null,
    text,
    links,
    location: stripHtml(rawItem?.lbs?.name || rawItem?.lbs?.idname || rawItem?.location || "") || null,
    media,
    comments,
    likes,
    metrics: {
      commentCount: Math.max(comments.length, commentMetric.count),
      likeCount: Math.max(likes.length, likeMetric.count),
      forwardCount: Number(rawItem?.fwdnum || rawItem?.forwardnum || 0) || 0,
    },
    sourceMeta: {
      adapter: "emotion_cgi_msglist_v6",
      parserVersion: 10,
      authorNickname: stripHtml(rawItem?.name || rawItem?.nickname || ""),
      sourceName: stripHtml(rawItem?.source_name || "") || null,
      commentCountReported: commentMetric.reported,
      likeCountReported: likeMetric.reported,
      isForward: Boolean(rawItem?.rt_tid || forwardedText || originalAuthorUin),
      originalSourceId: rawItem?.rt_tid ? String(rawItem.rt_tid) : null,
      originalAuthorUin: originalAuthorUin && originalAuthorUin !== authorUin ? originalAuthorUin : null,
    },
  };
}

function parseMoodListPage(text, ownerUin, { offset = 0, count = 20 } = {}) {
  const payload = parseJsonp(text);
  const code = Number(payload?.code ?? -1);
  if (code !== 0) {
    const message = String(payload?.message || payload?.msg || "QQ 空间说说接口返回失败");
    const error = new Error(code === -10000
      ? "QQ 说说分类接口暂时繁忙，请稍后重试"
      : isAuthenticationFailure(code)
        ? "QQ 登录会话已失效，请重新扫码登录"
        : `QQ 空间说说接口错误 ${code}：${message}`);
    error.code = code === -10000 ? "QZONE_MOOD_RATE_LIMITED" : code;
    error.businessCode = code;
    throw error;
  }
  const rawItems = Array.isArray(payload?.msglist) ? payload.msglist : [];
  const entries = rawItems.map((item) => parseEmotionItem(item, ownerUin)).filter(Boolean);
  const totalCandidate = Number(payload?.total ?? payload?.total_count);
  const total = Number.isFinite(totalCandidate) && totalCandidate >= 0 ? totalCandidate : null;
  const nextOffset = Math.max(0, Number(offset) || 0) + rawItems.length;
  const explicitMore = payload?.hasmore ?? payload?.has_more;
  const hasMore = explicitMore == null
    ? total == null ? rawItems.length >= Math.max(1, Number(count) || 20) : nextOffset < total
    : truthyMore(explicitMore);
  return {
    adapter: "mood_list",
    entries,
    rawCount: rawItems.length,
    statusCount: rawItems.length,
    eligibleCount: entries.length,
    appidCounts: { 311: rawItems.length },
    hasMore: Boolean(hasMore && rawItems.length > 0),
    cursor: hasMore && rawItems.length > 0 ? String(nextOffset) : "",
    pageNumber: Math.floor(Math.max(0, Number(offset) || 0) / Math.max(1, Number(count) || 20)) + 1,
    total,
    offset: Math.max(0, Number(offset) || 0),
  };
}

function extractExternalLinks(html) {
  const postHtml = String(html || "").split(/<[^>]+class=["'][^"']*mod-comments[^"']*["']/i)[0];
  const links = new Map();
  for (const match of postHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const candidate = ["href", "data-url", "data-href", "url"]
      .map((name) => attribute(attrs, name))
      .find(Boolean);
    const url = normalizeExternalUrl(candidate);
    if (!url || links.has(url)) continue;
    const label = stripHtml(match[2]) || (() => {
      try { return new URL(url).hostname; } catch { return "外部链接"; }
    })();
    links.set(url, { url, label: label.slice(0, 200) });
    if (links.size >= 20) break;
  }
  // Some share/video cards keep the destination in serialized card data
  // instead of an anchor. Scan only literal web URLs and apply the same host
  // and protocol allow-list; never parse or evaluate the embedded object.
  for (const match of decodeHtmlEntities(postHtml).matchAll(/https?:\/\/[^\s<>"'\\]+/gi)) {
    const url = normalizeExternalUrl(match[0]);
    if (!url || links.has(url)) continue;
    let label = "外部链接";
    try { label = new URL(url).hostname; } catch { /* Already validated above. */ }
    links.set(url, { url, label });
    if (links.size >= 20) break;
  }
  return [...links.values()];
}

function extractMedia(html) {
  const postHtml = String(html || "").split(/<[^>]+class=["'][^"']*mod-comments[^"']*["']/i)[0];
  const media = new Map();
  const videoPosters = new Set();
  const positions = new Map();
  const add = (url, position, kind = "image") => {
    const normalized = normalizeMediaUrl(url);
    if (normalized && !videoPosters.has(normalized) && !media.has(normalized)) {
      media.set(normalized, { kind, sourceUrl: normalized });
      positions.set(normalized, position);
    }
  };
  const addVideo = (videoUrl, posterUrl, attrs = "", position = 0) => {
    const sourceUrl = normalizeMediaUrl(videoUrl);
    const posterSourceUrl = normalizeMediaUrl(posterUrl);
    if (!sourceUrl && !posterSourceUrl) return;
    if (posterSourceUrl) videoPosters.add(posterSourceUrl);
    const key = `video:${sourceUrl || posterSourceUrl}`;
    if (media.has(key)) return;
    positions.set(key, position);
    media.set(key, {
      kind: "video",
      sourceUrl,
      posterSourceUrl,
      width: Number(attribute(attrs, "width")) || undefined,
      height: Number(attribute(attrs, "height")) || undefined,
    });
  };
  for (const match of postHtml.matchAll(/<video\b([^>]*)>[\s\S]*?<\/video>|<video\b([^>]*)\/?\s*>/gi)) {
    const attrs = match[1] || match[2] || "";
    const body = match[0];
    addVideo(
      attribute(attrs, "src") || attribute(attrs, "data-src") || body.match(/https?:\/\/[^\s<>'"\\]+\.mp4[^\s<>'"\\]*/i)?.[0],
      attribute(attrs, "poster") || attribute(attrs, "data-poster"),
      attrs,
      match.index,
    );
  }
  for (const match of postHtml.matchAll(/<(?:a|div)\b([^>]*class=["'][^"']*video[^"']*["'][^>]*)>([\s\S]*?)<\/(?:a|div)>/gi)) {
    const attrs = match[1];
    const body = match[2];
    const imageAttrs = body.match(/<img\b([^>]*)>/i)?.[1] || "";
    const linkedUrl = attribute(attrs, "href") || attribute(body.match(/<a\b([^>]*)>/i)?.[1], "href");
    if (normalizeExternalUrl(linkedUrl)) {
      const thumbnail = normalizeMediaUrl(attribute(imageAttrs, "src") || attribute(imageAttrs, "trueSrc"));
      if (thumbnail) videoPosters.add(thumbnail);
      continue;
    }
    addVideo(
      ["video", "video-url", "play-url", "src", "url"].map((name) => attribute(attrs, name)).find((url) => /\.mp4(?:\?|$)/i.test(url))
        || decodeHtmlEntities(`${attrs} ${body}`).match(/https?:\/\/[^\s<>'"\\]+\.mp4[^\s<>'"\\]*/i)?.[0],
      attribute(attrs, "poster") || attribute(attrs, "cover") || attribute(imageAttrs, "src") || attribute(imageAttrs, "trueSrc"),
      attrs,
      match.index,
    );
  }
  // data-pickey points at the original photo while the nested img src is a
  // rendered thumbnail of the same photo. Prefer originals for the whole post.
  for (const match of postHtml.matchAll(/data-pickey=["'][^,"']+,([^"']+)["']/gi)) add(match[1], match.index);
  const ordered = () => [...media.entries()].sort(([a], [b]) => positions.get(a) - positions.get(b)).map(([, item]) => item);
  if ([...media.values()].some((item) => item.kind === "image")) return ordered();
  for (const match of postHtml.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (/avatar|qlogo|emoji|emoticon|icon/gi.test(attrs) && !/img-item|photo|qpic/gi.test(attrs)) continue;
    add(attribute(attrs, "original") || attribute(attrs, "trueSrc") || attribute(attrs, "src") || attribute(attrs, "url"), match.index);
  }
  return ordered();
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
      authorName: name,
      text,
      isReply: attribute(attrs, "type") === "replyroot",
      source: "feeds3_html",
    };
  }).filter((comment) => comment.text || comment.authorName !== "QQ 用户");
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
  const feedDataIndex = html.search(/name=["']feed_data["']/i);
  const publisherRegion = feedDataIndex >= 0 ? html.slice(0, feedDataIndex) : html;
  const publisherCard = [...publisherRegion.matchAll(/<div\b[^>]*class=["'][^"']*\bf-nick\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].at(-1)?.[1] || "";
  const publisherCardUin = publisherCard.match(/nameCard_(\d+)/i)?.[1]
    || attribute(publisherCard, "uin");
  const feedDataUin = attribute(feedData, "uin");
  const authorUin = String(publisherCardUin || feedDataUin || feedId?.[1] || rawItem?.opuin || "");
  return {
    html,
    feedData,
    feedId,
    // The publisher card before feed_data is the strongest signal. QQ's
    // rawItem.opuin is not consistently the timeline publisher in scope=1.
    authorUin,
    originalAuthorUin: attribute(feedData, "origuin")
      || (feedDataUin && feedDataUin !== authorUin ? feedDataUin : ""),
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
  const { html, feedData, feedId, authorUin, originalAuthorUin, appid } = feedIdentity(rawItem);
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
  const typeId = String(rawItem?.typeid ?? attribute(feedData, "typeid") ?? "");
  const originalSourceId = attribute(feedData, "origtid");
  const shareTitle = stripHtml(rawItem?.appShareTitle || rawItem?.appname || rawItem?.appName || "");
  const links = extractExternalLinks(html);
  if (!text && shareTitle) text = shareTitle;
  if (!text && links.length) text = links[0].label || "转发内容";
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
  if (!text && !media.length && !links.length) return null;
  return {
    sourceId,
    type: "post",
    createdAt: createdSeconds > 0 ? new Date(createdSeconds * 1000).toISOString() : "",
    title: null,
    text,
    links,
    media,
    comments,
    likes,
    metrics: { commentCount, likeCount },
    sourceMeta: {
      adapter: "feeds3_html_more",
      parserVersion: 10,
      appid,
      typeId,
      isForward: typeId === "5" || Boolean(originalSourceId),
      originalSourceId: originalSourceId || null,
      originalAuthorUin: originalAuthorUin && originalAuthorUin !== authorUin ? originalAuthorUin : null,
      authorNickname: nickname,
      shareTitle: shareTitle || null,
    },
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
  normalizeExternalUrl,
  normalizeQzoneMentions,
  parseEmotionItem,
  parseComments,
  parseFeedItem,
  parseFeeds3Page,
  parseJsonp,
  parseLikeListPage,
  parseMoodListPage,
  parseRawFeeds3Page,
  stripHtml,
};
