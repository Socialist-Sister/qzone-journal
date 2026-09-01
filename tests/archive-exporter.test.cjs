const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildExportModel,
  renderDocxExport,
  renderHtmlExport,
  sanitizeExportOptions,
} = require("../desktop/archive/exporter.cjs");

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function fixtureEntries() {
  return [
    {
      sourceId: "post-new",
      type: "post",
      createdAt: "2026-08-29T12:30:00+08:00",
      text: "和 @{uin:983109480,nick:阿程,who:1,auto:1} 看海 [em]e10264[/em]",
      location: "海边",
      links: [{ url: "https://example.com/video?uin=983109480&part=1#friend", label: "阿程分享的视频" }, { url: "https://user.qzone.qq.com/983109480", label: "好友空间" }, { url: "javascript:alert(1)", label: "坏链接" }],
      media: [{ localPath: "media/files/test.png", contentType: "image/png" }, { localPath: "../secret.txt", contentType: "text/plain" }],
      comments: [{ authorName: "阿程", text: "下次再去 @林屿" }],
      likes: [{ name: "阿程" }, { name: "小周" }],
      metrics: { commentCount: 4, likeCount: 8 },
    },
    {
      sourceId: "post-old",
      type: "post",
      createdAt: "2025-01-02T08:00:00+08:00",
      text: "旧内容",
      media: [],
      comments: [],
      likes: [],
      metrics: {},
    },
  ];
}

test("export options are allow-listed and dates are bounded", () => {
  assert.deepEqual(sanitizeExportOptions({ format: "exe", scope: "unknown", media: "remote", type: "other", dateFrom: "2026/01/01" }), {
    format: "html",
    scope: "all",
    type: "all",
    query: "",
    dateFrom: "",
    dateTo: "",
    includeComments: true,
    includeLikes: true,
    anonymize: true,
    media: "compact",
    confirmedPeople: false,
  });
});

test("export model filters dates and anonymizes people consistently", () => {
  const model = buildExportModel({
    entries: fixtureEntries(),
    profileName: "林屿的空间",
    ownerNickname: "林屿",
    options: { scope: "dates", dateFrom: "2026-01-01", dateTo: "2026-12-31", anonymize: true },
  });
  assert.equal(model.entries.length, 1);
  assert.equal(model.entries[0].comments[0].authorName, "好友 1");
  assert.deepEqual(model.entries[0].likes, ["好友 1", "好友 2"]);
  assert.match(model.entries[0].text, /@好友 1/);
  assert.doesNotMatch(JSON.stringify(model), /983109480|阿程|小周/);
  assert.equal(model.entries[0].commentCount, 4);
  assert.equal(model.entries[0].likeCount, 8);
  assert.deepEqual(model.entries[0].links, [{ url: "https://example.com/video?part=1", label: "好友 1分享的视频" }]);
});

test("anonymous friend numbering restarts per post and reuses complete nicknames in replies", () => {
  const ownerNickname = "譜瑞♡僵斯";
  const model = buildExportModel({
    profileName: `${ownerNickname}的空间`,
    ownerNickname,
    options: { anonymize: true, includeComments: true, includeLikes: true },
    entries: [
      {
        sourceId: "complex-names",
        type: "post",
        createdAt: "2026-08-31T12:00:00+08:00",
        text: "第一篇",
        comments: [
          { authorName: "ヾ(◍°∇°◍)ﾉﾞ", text: "登录点几乎重叠" },
          { authorName: ownerNickname, text: "@ヾ(◍°∇°◍)ﾉﾞ 台州坎门街道" },
          { authorName: "Lorrinius.Asuka.", text: "怎么不去日本了" },
          { authorName: ownerNickname, text: "@Lorrinius.Asuka. 受到卓妹感召" },
        ],
        likes: [],
      },
      {
        sourceId: "second-post",
        type: "post",
        createdAt: "2026-08-30T12:00:00+08:00",
        text: "第二篇",
        comments: [{ authorName: "另一位好友", text: "新一篇重新编号" }],
        likes: [],
      },
    ],
  });

  assert.deepEqual(model.entries[0].comments.map((comment) => comment.authorName), [
    "好友 1",
    ownerNickname,
    "好友 2",
    ownerNickname,
  ]);
  assert.match(model.entries[0].comments[1].text, /^@好友 1 /);
  assert.match(model.entries[0].comments[3].text, /^@好友 2 /);
  assert.doesNotMatch(JSON.stringify(model.entries[0]), /好友 [34]/);
  assert.equal(model.entries[1].comments[0].authorName, "好友 1");
});

test("visible interaction names require an explicit second confirmation", () => {
  assert.throws(() => buildExportModel({
    entries: fixtureEntries(),
    profileName: "林屿的空间",
    ownerNickname: "林屿",
    options: { anonymize: false, includeComments: true, includeLikes: true },
  }), /再次确认/);
});

test("offline HTML embeds safe media and contains no active script surface", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-export-html-"));
  await fs.mkdir(path.join(root, "media", "files"), { recursive: true });
  await fs.writeFile(path.join(root, "media", "files", "test.png"), ONE_PIXEL_PNG);
  const model = buildExportModel({ entries: fixtureEntries(), profileName: "林屿的空间", ownerNickname: "林屿", options: { format: "html", anonymize: true, media: "original" } });
  const html = await renderHtmlExport({ model, archiveRoot: root });
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /QQ表情/);
  assert.doesNotMatch(html, /javascript:|983109480|阿程|小周/);
  assert.equal((html.match(/<img /g) || []).length, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("DOCX export produces an OOXML package with Chinese archive content", async () => {
  const model = buildExportModel({ entries: fixtureEntries().map((entry) => ({ ...entry, media: [] })), profileName: "林屿的空间", ownerNickname: "林屿", options: { format: "docx", anonymize: true, media: "omit" } });
  const output = await renderDocxExport({ model, archiveRoot: os.tmpdir() });
  assert.ok(Buffer.isBuffer(output));
  assert.equal(output.subarray(0, 2).toString("ascii"), "PK");
  assert.ok(output.length > 5000);
});
