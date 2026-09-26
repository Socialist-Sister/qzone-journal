const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeQzoneMentions, parseFeeds3Page, parseLikeListPage, parseMoodListPage } = require("../desktop/collector/qzone-parser.cjs");
const { buildFeeds3Url, buildLikeListUrl, buildMoodListUrl, fetchLikeList, fetchMoodPage, fetchMoodPageOnce } = require("../desktop/collector/qzone-adapter.cjs");

test("feeds3 parser normalizes a titleless post, media, comments and visible likes", () => {
  const html = `<div id="feed_12345678_311_0_1700000000_0_1">
    <div class="f-nick"><a class="f-name">归档用户</a></div>
    <div class="f-info">今天拍到一朵云&amp;晚霞</div>
    <i name="feed_data" data-tid="abc123def" data-uin="12345678" data-abstime="1700000000" data-cmtnum="1" data-likecount="2"></i>
    <a class="img-item" data-pickey="abc123def,https://photogz.photo.store.qq.com/a.jpg?x=1&amp;y=2"><img src="https://qpic.cn/thumb.jpg"></a>
    <div class="mod-like"><a class="q_namecard" link="nameCard_90001">小周</a><a class="q_namecard" link="nameCard_90002">阿程</a></div>
    <div class="mod-comments"><ul><li class="comments-item" data-type="commentroot" data-tid="1" data-uin="90001" data-nick="小周"><div class="comments-content"><a class="nickname">小周</a>&nbsp;:&nbsp;真好看</div></li></ul></div>
  </div>`;
  const payload = `_Callback(${JSON.stringify({ code: 0, data: { main: { hasMoreFeeds: true, externparam: "basetime=1699990000&pagenum=2" }, data: [{ key: "fallback", opuin: "12345678", nickname: "归档用户", html }] } })});`;
  const page = parseFeeds3Page(payload, "12345678");
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].title, null);
  assert.equal(page.entries[0].text, "今天拍到一朵云&晚霞");
  assert.equal(page.entries[0].media.length, 1);
  assert.equal(page.entries[0].comments[0].text, "真好看");
  assert.equal(page.entries[0].comments[0].authorName, "小周");
  assert.deepEqual(page.entries[0].likes.map((like) => like.name), ["小周", "阿程"]);
  assert.equal(page.entries[0].metrics.likeCount, 2);
  assert.equal(page.hasMore, true);
  assert.match(page.cursor, /pagenum=2/);
});

test("feeds3 parser reports authentication failures", () => {
  assert.throws(() => parseFeeds3Page('_Callback({"code":-3000,"message":"need login"});', "12345678"), /重新扫码登录/);
  assert.throws(() => parseFeeds3Page('_Callback({"code":-10006,"message":"login expired"});', "12345678"), /重新扫码登录/);
});

test("mood category parser normalizes own text, pictures, forwards, comments and totals", () => {
  const payload = `_preloadCallback(${JSON.stringify({
    code: 0,
    total: 3,
    msglist: [{
      tid: "mood-1",
      uin: 12345678,
      name: "归档用户",
      content: "我转发时写下的内容[em]e10264[/em] @{uin:983109480,nick:Lorrinius.Asuka.,who:1,auto:1}",
      created_time: 1700000000,
      cmtnum: 2,
      likenum: 3,
      fwdnum: 1,
      source_name: "iPhone",
      pic: [{ url1: "https://photogz.photo.store.qq.com/original.jpg", width: 1080, height: 720 }],
      rt_tid: "origin-9",
      rt_uin: 87654321,
      rt_con: { content: "原动态正文", url: "https://www.bilibili.com/video/BV1Test" },
      commentlist: [{ tid: "comment-1", uin: 90001, name: "小周", content: "收到 @{uin:90002,nick:阿程 同学,who:1,auto:1}", list_3: [{ tid: "reply-1", uin: 90002, name: "阿程", content: "回复一下" }] }],
      like_uin_info: [{ fuin: 90001, nick: "小周" }],
    }, {
      tid: "mood-2",
      uin: 12345678,
      content: "第二条",
      created_time: 1699999999,
    }],
  })});`;
  const page = parseMoodListPage(payload, "12345678", { offset: 0, count: 2 });
  assert.equal(page.adapter, "mood_list");
  assert.equal(page.entries.length, 2);
  assert.equal(page.entries[0].title, null);
  assert.equal(page.entries[0].text, "我转发时写下的内容[em]e10264[/em] @Lorrinius.Asuka.\n\n转发内容：原动态正文");
  assert.equal(page.entries[0].media.length, 1);
  assert.equal(page.entries[0].media[0].width, 1080);
  assert.deepEqual(page.entries[0].links, [{ url: "https://www.bilibili.com/video/BV1Test", label: "www.bilibili.com" }]);
  assert.equal(page.entries[0].comments.length, 2);
  assert.equal(page.entries[0].comments[0].text, "收到 @阿程 同学");
  assert.equal(page.entries[0].comments[1].isReply, true);
  assert.equal(page.entries[0].likes[0].name, "小周");
  assert.equal(page.entries[0].metrics.likeCount, 3);
  assert.equal(page.entries[0].sourceMeta.parserVersion, 10);
  assert.equal(page.total, 3);
  assert.equal(page.cursor, "2");
  assert.equal(page.hasMore, true);
});

test("QQ mention tokens keep only nicknames and never expose internal UIN fields", () => {
  assert.equal(
    normalizeQzoneMentions("和 @{uin:983109480,nick:Lorrinius.Asuka.,who:1,auto:1} 一起出门"),
    "和 @Lorrinius.Asuka. 一起出门",
  );
  assert.equal(
    normalizeQzoneMentions("@{who:1,nick:昵称,带逗号,uin:42,auto:1} @{uin:7,who:1}"),
    "@昵称,带逗号 @QQ好友",
  );
  assert.equal(
    normalizeQzoneMentions("@{uin:7,nick:阿程,who:1,auto:1}回复正文"),
    "@阿程 回复正文",
  );
});

test("mood category parser keeps native QQ videos and does not duplicate their covers as pictures", () => {
  const payload = `_preloadCallback(${JSON.stringify({
    code: 0,
    total: 2,
    msglist: [{
      tid: "native-video-only",
      uin: 12345678,
      content: "",
      created_time: 1700000000,
      video: [{
        video_id: "1074_video_only",
        pic_url: "http://photogzmaz.photo.store.qq.com/video-cover.jpg",
        url1: "https://photogzmaz.photo.store.qq.com/video-thumb.jpg",
        url3: "https://photovideo.photo.qq.com/native-video.mp4",
        duration: 12500,
        width: 1920,
        height: 1080,
      }],
      pic: [{ url1: "https://photogzmaz.photo.store.qq.com/video-cover.jpg" }],
    }, {
      tid: "native-video-mixed",
      uin: 12345678,
      content: "图片和视频",
      created_time: 1699999999,
      pic: [{ url1: "https://photogz.photo.store.qq.com/photo.jpg" }, {
        url1: "https://photogz.photo.store.qq.com/mixed-cover.jpg",
        video_info: { video_id: "1074_mixed", url3: "https://photovideo.photo.qq.com/mixed.mp4", duration: 8000 },
      }],
    }],
  })});`;
  const page = parseMoodListPage(payload, "12345678", { offset: 0, count: 20 });
  assert.equal(page.entries.length, 2);
  assert.equal(page.entries[0].media.length, 1);
  assert.equal(page.entries[0].media[0].kind, "video");
  assert.equal(page.entries[0].media[0].sourceUrl, "https://photovideo.photo.qq.com/native-video.mp4");
  assert.equal(page.entries[0].media[0].posterSourceUrl, "https://photogzmaz.photo.store.qq.com/video-cover.jpg");
  assert.equal(page.entries[0].media[0].durationMs, 12500);
  assert.deepEqual(page.entries[1].media.map((media) => media.kind), ["image", "video"]);
  assert.equal(page.entries[1].media[1].posterSourceUrl, "https://photogz.photo.store.qq.com/mixed-cover.jpg");
});

test("mood category parser rejects another publisher and identifies rate limiting", () => {
  const other = `_preloadCallback(${JSON.stringify({ code: 0, total: 1, msglist: [{ tid: "other", uin: 87654321, content: "好友内容" }] })});`;
  const page = parseMoodListPage(other, "12345678", { offset: 0, count: 20 });
  assert.equal(page.entries.length, 0);
  assert.throws(
    () => parseMoodListPage('_preloadCallback({"code":-10000,"message":"busy"});', "12345678"),
    (error) => error.code === "QZONE_MOOD_RATE_LIMITED",
  );
});

test("mood category request uses the owner's category and numeric offset", () => {
  const url = new URL(buildMoodListUrl({ uin: "12345678", gTk: 456, cursor: "40", count: 20 }));
  assert.match(url.hostname, /qzone\.qq\.com$/);
  assert.match(url.pathname, /emotion_cgi_msglist_v6$/);
  assert.equal(url.searchParams.get("uin"), "12345678");
  assert.equal(url.searchParams.get("pos"), "40");
  assert.equal(url.searchParams.get("num"), "20");
});

test("like-list parser keeps display names, totals and pagination without exposing response text", async () => {
  const first = parseLikeListPage(`_Callback(${JSON.stringify({
    code: 0,
    data: {
      total_number: 3,
      has_more: 1,
      like_uin_info: [{ fuin: 90001, nick: "很长很长的点赞者昵称" }, { fuin: 90002, nick: "小周" }],
    },
  })});`, { count: 2 });
  assert.equal(first.total, 3);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, "90002");
  assert.deepEqual(first.likes.map((like) => like.name), ["很长很长的点赞者昵称", "小周"]);

  const requested = [];
  const response = (url, body) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => "application/json" },
    text: async () => body,
  });
  const result = await fetchLikeList({ uin: "12345678", tid: "mood-1", gTk: 456 }, {
    fetch: async (url) => {
      requested.push(url);
      const beginUin = new URL(url).searchParams.get("begin_uin");
      return beginUin === "0"
        ? response(url, `_Callback(${JSON.stringify({ code: 0, data: { total_number: 2, has_more: 1, like_uin_info: [{ fuin: 90001, nick: "小周" }] } })});`)
        : response(url, `_Callback(${JSON.stringify({ code: 0, data: { total_number: 2, has_more: 0, like_uin_info: [{ fuin: 90002, nick: "阿程" }] } })});`);
    },
    delay: async () => undefined,
  });
  assert.equal(requested.length, 2);
  assert.deepEqual(result.likes.map((like) => like.name), ["小周", "阿程"]);
  assert.equal(result.total, 2);

  const url = new URL(buildLikeListUrl({ uin: "12345678", tid: "mood-1", gTk: 456 }));
  assert.equal(url.hostname, "user.qzone.qq.com");
  assert.equal(url.searchParams.get("unikey"), "http://user.qzone.qq.com/12345678/mood/mood-1");
  assert.equal(url.searchParams.get("query_count"), "60");
  assert.equal(url.searchParams.get("if_first_page"), "1");
});

test("like-list parser classifies rate limiting as a resumable interaction boundary", () => {
  assert.throws(
    () => parseLikeListPage('_Callback({"code":-10000,"message":"busy"});'),
    (error) => error.code === "QZONE_INTERACTION_RATE_LIMITED",
  );
});

test("category rate limiting falls back only to the personal scope=1 timeline", async () => {
  const requested = [];
  const response = (url, body) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => "application/json" },
    text: async () => body,
  });
  const page = await fetchMoodPage({ uin: "12345678", gTk: 123, cursor: "" }, {
    fetch: async (url) => {
      requested.push(url);
      if (url.includes("emotion_cgi_msglist_v6")) return response(url, '_preloadCallback({"code":-10000,"message":"busy"});');
      return response(url, '_Callback({"code":0,"data":{"main":{"hasMoreFeeds":false},"data":[]}});');
    },
    delay: async () => undefined,
  });
  assert.equal(page.adapter, "feeds3_personal");
  const feedsRequest = new URL(requested.find((url) => url.includes("feeds3_html_more")));
  assert.equal(feedsRequest.searchParams.get("scope"), "1");
  assert.equal(feedsRequest.searchParams.get("uinlist"), "");
  assert.equal(page.diagnostic.categoryRateLimited, true);
});

test("feeds3 parser accepts QQ JavaScript-style hexadecimal escapes without evaluating the response", () => {
  const html = '<div id="feed_12345678_311_0_1700000000_0_1"><div class="f-info">带转义的动态</div><i name="feed_data" data-tid="escaped-1" data-uin="12345678" data-abstime="1700000000"></i></div>';
  const strictPayload = JSON.stringify({ code: 0, data: { main: { hasMoreFeeds: false }, data: [{ key: "escaped-1", opuin: "12345678", html }] } });
  const qzonePayload = `_Callback(${strictPayload.replace(/\\\"/g, "\\x22").replace(/</g, "\\x3C")});`;
  const page = parseFeeds3Page(qzonePayload, "12345678");
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].text, "带转义的动态");
});

test("feeds3 parser falls back to HTML blocks when QQ returns a JavaScript object literal", () => {
  const escapedHtml = '<div id=\\x22feed_12345678_311_0_1700000000_0_1\\x22 data-key=\\x22raw-1\\x22><div class=\\x22f-info\\x22>对象字面量动态</div><i name=\\x22feed_data\\x22 data-tid=\\x22raw-1\\x22 data-uin=\\x2212345678\\x22 data-abstime=\\x221700000000\\x22></i></div>';
  const response = `_Callback({code:0,data:{main:{hasMoreFeeds:true,externparam:'offset=10&total=20&basetime=1699990000'},data:[{key:'raw-1',opuin:'12345678',html:'${escapedHtml}'}]}});`;
  const page = parseFeeds3Page(response, "12345678");
  assert.equal(page.rawCount, 1);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].sourceId, "raw-1");
  assert.equal(page.entries[0].text, "对象字面量动态");
  assert.equal(page.hasMore, true);
  assert.match(page.cursor, /(?:^|&)pagenum=2(?:&|$)/);
});

test("feeds3 parser removes escaped template whitespace and excludes non-status activities", () => {
  const statusHtml = '<div id="feed_12345678_311_0_1700000000_0_1"><div class="f-info">\\t\\t真正的正文\\n第二行</div><i name="feed_data" data-tid="clean-1" data-uin="12345678" data-abstime="1700000000"></i></div>';
  const profileHtml = '<div id="feed_12345678_403_0_1700000001_0_1"><div class="f-info">某人的主页</div><i name="feed_data" data-tid="noise-1" data-uin="12345678" data-abstime="1700000001"></i></div>';
  const payload = `_Callback(${JSON.stringify({ code: 0, data: { main: { hasMoreFeeds: true, externparam: "offset=10&total=20&basetime=1699990000" }, data: [{ appid: 311, opuin: "12345678", html: statusHtml }, { appid: 403, opuin: "12345678", html: profileHtml }] } })});`;
  const page = parseFeeds3Page(payload, "12345678");
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].text, "真正的正文\n第二行");
  assert.equal(page.entries[0].sourceMeta.parserVersion, 10);
  assert.match(page.cursor, /pagenum=2/);
  assert.equal(page.eligibleCount, 1);
});

test("feeds3 request repairs a legacy checkpoint cursor before resuming", () => {
  const url = new URL(buildFeeds3Url({
    uin: "12345678",
    gTk: 123,
    cursor: "offset=90&total=31&basetime=1787547569&feedsource=1",
  }));
  assert.equal(url.searchParams.get("pagenum"), "10");
  assert.match(url.searchParams.get("externparam"), /(?:^|&)pagenum=10(?:&|$)/);
  assert.equal(url.searchParams.get("refresh"), "0");
});

test("personal archives reject the scope=0 friend feed", () => {
  assert.throws(() => buildFeeds3Url({ uin: "12345678", gTk: 123, scope: 0 }), /好友动态流不允许/);
});

test("feeds3 diagnostics distinguish status posts from another author", () => {
  const ownHtml = '<div id="feed_12345678_311_0_1700000000_0_1"><div class="f-info">本人动态</div><i name="feed_data" data-tid="own" data-uin="12345678" data-abstime="1700000000"></i></div>';
  const otherHtml = '<div id="feed_87654321_311_0_1700000001_0_1"><div class="f-info">好友动态</div><i name="feed_data" data-tid="other" data-uin="87654321" data-abstime="1700000001"></i></div>';
  const payload = `_Callback(${JSON.stringify({ code: 0, data: { main: { hasMoreFeeds: false }, data: [{ appid: 311, opuin: "12345678", html: ownHtml }, { appid: 311, opuin: "87654321", html: otherHtml }] } })});`;
  const page = parseFeeds3Page(payload, "12345678");
  assert.equal(page.statusCount, 2);
  assert.equal(page.eligibleCount, 1);
  assert.equal(page.entries.length, 1);
  assert.deepEqual(page.appidCounts, { 311: 2 });
});

test("scope=1 uses feed_data publisher when raw opuin points elsewhere", () => {
  const html = '<div id="feed_87654321_311_0_1700000000_0_1"><div class="f-nick"><a class="f-name">本人</a></div><div class="f-info">本人动态</div><i name="feed_data" data-tid="own-scope1" data-uin="12345678" data-abstime="1700000000"></i></div>';
  const payload = `_Callback(${JSON.stringify({ code: 0, data: { main: { hasMoreFeeds: false }, data: [{ appid: 311, opuin: "87654321", html }] } })});`;
  const page = parseFeeds3Page(payload, "12345678");
  assert.equal(page.eligibleCount, 1);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].text, "本人动态");
});

test("image posts keep text before feed_data and prefer originals over thumbnails", () => {
  const html = `<div id="feed_12345678_311_0_1700000000_0_1">
    <p class="txt-box-title ellipsis-one">带图说说正文</p>
    <a class="img-item" data-pickey="photo-1,https://photonjmaz.photo.store.qq.com/psc?original=1"><img src="https://a1.qpic.cn/psc?thumbnail=1"></a>
    <i name="feed_data" data-tid="image-post" data-uin="12345678" data-abstime="1700000000"></i>
  </div>`;
  const payload = `_Callback(${JSON.stringify({ code: 0, data: { main: { hasMoreFeeds: false }, data: [{ appid: 311, opuin: "12345678", html }] } })});`;
  const page = parseFeeds3Page(payload, "12345678");
  assert.equal(page.entries[0].text, "带图说说正文");
  assert.equal(page.entries[0].media.length, 1);
  assert.match(page.entries[0].media[0].sourceUrl, /photo\.store\.qq\.com/);
});

test("forwarded posts use the timeline publisher and retain external video links", () => {
  const html = `<div id="feed_12345678_311_0_1700000000_0_1">
    <div class="f-info">转发：这个讲得很清楚</div>
    <i name="feed_data" data-tid="forward-1" data-origtid="original-9" data-uin="12345678" data-origuin="87654321" data-typeid="5" data-abstime="1700000000"></i>
    <div class="forward-card"><a href="https://www.bilibili.com/video/BV1Test">演示视频</a><span data-card="https://b23.tv/anotherTest">备用视频</span><p>原动态正文</p></div>
  </div>`;
  const payload = `_Callback(${JSON.stringify({ code: 0, data: { main: { hasMoreFeeds: false }, data: [{ appid: 311, typeid: 5, opuin: "12345678", nickname: "归档用户", html }] } })});`;
  const page = parseFeeds3Page(payload, "12345678");
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].sourceId, "forward-1");
  assert.equal(page.entries[0].text, "转发：这个讲得很清楚");
  assert.equal(page.entries[0].sourceMeta.isForward, true);
  assert.equal(page.entries[0].sourceMeta.originalAuthorUin, "87654321");
  assert.deepEqual(page.entries[0].links, [
    { url: "https://www.bilibili.com/video/BV1Test", label: "演示视频" },
    { url: "https://b23.tv/anotherTest", label: "b23.tv" },
  ]);
  assert.equal(page.eligibleCount, 1);
});

test("feeds3 uses a conservative default page size", () => {
  const url = new URL(buildFeeds3Url({ uin: "12345678", gTk: 123 }));
  assert.equal(url.searchParams.get("count"), "20");
});

test("a later cursor retries one -10001 response with a fresh request nonce", async () => {
  const requestedUrls = [];
  const delays = [];
  const response = (body) => ({
    ok: true,
    status: 200,
    url: "https://user.qzone.qq.com/",
    headers: { get: () => "application/json" },
    text: async () => body,
  });
  const page = await fetchMoodPageOnce({
    uin: "12345678",
    gTk: 123,
    cursor: "offset=20&basetime=1699990000&pagenum=2",
  }, {
    fetch: async (url) => {
      requestedUrls.push(url);
      if (requestedUrls.length === 1) return response('_Callback({"code":-10001,"message":"busy"});');
      return response('_Callback({"code":0,"data":{"main":{"hasMoreFeeds":false},"data":[]}});');
    },
    delay: async (milliseconds) => { delays.push(milliseconds); },
  });
  assert.equal(page.rawCount, 0);
  assert.equal(requestedUrls.length, 2);
  assert.notEqual(requestedUrls[0], requestedUrls[1]);
  assert.equal(delays.length, 1);
  assert.ok(delays[0] >= 2200);
});

test("a first-page -10001 remains an immediate authentication failure", async () => {
  let calls = 0;
  await assert.rejects(() => fetchMoodPageOnce({ uin: "12345678", gTk: 123 }, {
    fetch: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        url: "https://user.qzone.qq.com/",
        headers: { get: () => "application/json" },
        text: async () => '_Callback({"code":-10001,"message":"expired"});',
      };
    },
    delay: async () => assert.fail("first-page auth failures must not be delayed"),
  }), /重新扫码登录/);
  assert.equal(calls, 1);
});


test("video thumbnail aliases are excluded and duplicate video fields preserve the playable source", () => {
  const page = parseMoodListPage(JSON.stringify({ code: 0, msglist: [{ tid: "aliases", uin: "12345678", created_time: 1700000000,
    video: [{ video_id: "vid", pic_url: "https://qpic.cn/cover.jpg", url1: "https://qpic.cn/thumb.jpg" },
      { video_id: "vid", url3: "https://photovideo.photo.qq.com/video.mp4" }],
    pic: [{ url1: "https://qpic.cn/thumb.jpg" }, { url1: "https://qpic.cn/normal.jpg" }],
  }] }), "12345678");
  assert.equal(page.entries[0].media.length, 2);
  const video = page.entries[0].media.find((item) => item.kind === "video");
  assert.equal(video.sourceUrl, "https://photovideo.photo.qq.com/video.mp4");
  assert.equal(video.posterSourceUrl, "https://qpic.cn/cover.jpg");
});

test("an external video card never becomes a native QQ video from its cached thumbnail", () => {
  const html = `<div id="feed_12345678_311_0_1700000000_0_1"><div class="f-info">分享的视频</div><i name="feed_data" data-tid="external" data-uin="12345678" data-abstime="1700000000"></i><a class="video-card" href="https://b23.tv/example"><img src="https://qpic.cn/external-thumbnail.jpg"></a></div>`;
  const page = parseFeeds3Page(JSON.stringify({ code: 0, data: { main: {}, data: [{ html }] } }), "12345678");
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].media.length, 0);
  assert.ok(page.entries[0].links.some((link) => link.url === "https://b23.tv/example"));
});


test("later like-list rejection preserves names already obtained without retrying the boundary", async () => {
  let requests = 0;
  const result = await fetchLikeList({ uin: "12345678", tid: "partial-likes", gTk: 1 }, {
    fetch: async (url) => {
      requests += 1;
      return { ok: true, status: 200, url, headers: new Headers(), text: async () => JSON.stringify(requests === 1
        ? { code: 0, data: { total_number: 2, has_more: 1, like_uin_info: [{ fuin: 90001, nick: "已取得名字" }] } }
        : { code: -10000 }) };
    }, delay: async () => undefined,
  });
  assert.equal(requests, 2);
  assert.equal(result.partial, true);
  assert.equal(result.partialCode, "QZONE_INTERACTION_RATE_LIMITED");
  assert.deepEqual(result.likes.map(person => person.name), ["已取得名字"]);
});


test("mixed QQ media retains video slots 4, 6 and 7 regardless of video array order", () => {
  const { mixedMediaPayload } = require("./fixtures/mixed-media.cjs");
  for (const legacy of [false, true]) {
    const media = parseMoodListPage(JSON.stringify(mixedMediaPayload({ legacy })), "12345678").entries[0].media;
    assert.deepEqual(media.map((item, index) => item.kind === "video" ? index + 1 : null).filter(Boolean), [4, 6, 7]);
    assert.equal(media.length, 9);
    assert.deepEqual(media.filter(item => item.kind === "video").map(item => item.videoId), ["video-4", "video-6", "video-7"]);
    assert.ok(media.filter(item => item.kind === "video").every(item => item.sourceUrl.endsWith(".mp4")));
  }
});

test("forwarded mixed media follows each source container and keeps unpositioned videos", () => {
  const { mixedMediaPayload } = require("./fixtures/mixed-media.cjs");
  const original = mixedMediaPayload().msglist[0];
  const payload = { code: 0, msglist: [{ tid: "forward", uin: "12345678", pic: [{ url1: "https://qpic.cn/own.jpg" }], rt_con: original }] };
  const media = parseMoodListPage(JSON.stringify(payload), "12345678").entries[0].media;
  assert.equal(media[0].sourceUrl, "https://qpic.cn/own.jpg");
  assert.deepEqual(media.map((item, index) => item.kind === "video" ? index + 1 : null).filter(Boolean), [5, 7, 8]);
  delete original.pic;
  const videoOnly = parseMoodListPage(JSON.stringify(payload), "12345678").entries[0].media;
  assert.deepEqual(videoOnly.map(item => item.kind), ["image", "video", "video", "video"]);
});

test("feeds3 mixed media keeps HTML order and excludes nested thumbnails", () => {
  for (const originals of [true, false]) {
    const photo = (id) => originals ? `<a data-pickey="id,https://qpic.cn/${id}.jpg"><img src="https://qpic.cn/${id}-thumb.jpg"></a>` : `<img src="https://qpic.cn/${id}.jpg">`;
    const html = `<div id="feed_12345678_311_0_1700000000_0_1"><i name="feed_data" data-tid="mixed-html" data-uin="12345678" data-abstime="1700000000"></i>${photo("first")}<div class="video-card" data-video-url="https://photovideo.photo.qq.com/clip.mp4"><img src="https://qpic.cn/cover.jpg"></div>${photo("last")}</div>`;
    const media = parseFeeds3Page(JSON.stringify({ code: 0, data: { main: {}, data: [{ html }] } }), "12345678").entries[0].media;
    assert.deepEqual(media.map(item => item.kind), ["image", "video", "image"]);
    assert.equal(media[0].sourceUrl, "https://qpic.cn/first.jpg");
    assert.equal(media[2].sourceUrl, "https://qpic.cn/last.jpg");
  }
});
