const assert = require("node:assert/strict");
const test = require("node:test");
const { parseFeeds3Page } = require("../desktop/collector/qzone-parser.cjs");
const { buildFeeds3Url } = require("../desktop/collector/qzone-adapter.cjs");

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
  assert.deepEqual(page.entries[0].likes.map((like) => like.name), ["小周", "阿程"]);
  assert.equal(page.entries[0].metrics.likeCount, 2);
  assert.equal(page.hasMore, true);
  assert.match(page.cursor, /pagenum=2/);
});

test("feeds3 parser reports authentication failures", () => {
  assert.throws(() => parseFeeds3Page('_Callback({"code":-3000,"message":"need login"});', "12345678"), /重新扫码登录/);
  assert.throws(() => parseFeeds3Page('_Callback({"code":-10006,"message":"login expired"});', "12345678"), /重新扫码登录/);
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
  assert.equal(page.entries[0].sourceMeta.parserVersion, 3);
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

test("feeds3 request can fall back to a filtered friend feed", () => {
  const url = new URL(buildFeeds3Url({ uin: "12345678", gTk: 123, scope: 0 }));
  assert.equal(url.searchParams.get("scope"), "0");
  assert.equal(url.searchParams.get("uinlist"), "12345678");
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
