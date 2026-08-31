const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeQzoneMentions, parseFeeds3Page, parseMoodListPage } = require("../desktop/collector/qzone-parser.cjs");
const { buildFeeds3Url, buildMoodListUrl, fetchMoodPage, fetchMoodPageOnce } = require("../desktop/collector/qzone-adapter.cjs");

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
  assert.equal(page.entries[0].sourceMeta.parserVersion, 7);
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
  assert.equal(page.entries[0].sourceMeta.parserVersion, 7);
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
