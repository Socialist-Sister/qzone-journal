const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { isSafeExternalUrl, isTrustedAppUrl } = require("../desktop/security.cjs");
const { assertMinimumFreeSpace } = require("../desktop/storage-safety.cjs");
const { RELEASES_API, RELEASES_ATOM, checkForUpdates, compareVersions, parseVersion, validReleaseUrl } = require("../desktop/update.cjs");
const { MAX_MEDIA_BYTES, MAX_VIDEO_BYTES, downloadMedia, fetchAllowedMedia, readLimitedResponseBody } = require("../desktop/collector/qzone-adapter.cjs");
const { normalizeMediaUrl } = require("../desktop/collector/qzone-parser.cjs");
const { ArchiveStore } = require("../desktop/archive/store.cjs");

test("app URL validation uses exact origins and packaged roots", () => {
  assert.equal(isTrustedAppUrl("http://127.0.0.1:4173/archive", { packaged: false, devServerUrl: "http://127.0.0.1:4173", clientRoot: "x" }), true);
  assert.equal(isTrustedAppUrl("http://127.0.0.1:41730/archive", { packaged: false, devServerUrl: "http://127.0.0.1:4173", clientRoot: "x" }), false);
  const clientRoot = path.resolve("dist/client");
  assert.equal(isTrustedAppUrl(pathToFileURL(path.join(clientRoot, "index.html")).href, { packaged: true, devServerUrl: "", clientRoot }), true);
  assert.equal(isTrustedAppUrl(pathToFileURL(path.resolve("dist/secret.html")).href, { packaged: true, devServerUrl: "", clientRoot }), false);
  assert.equal(isSafeExternalUrl("https://github.com/example"), true);
  assert.equal(isSafeExternalUrl("https://user:pass@github.com/example"), false);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
});

test("minimum free-space guard fails before collection starts", async () => {
  await assert.rejects(() => assertMinimumFreeSpace("C:\\archive", {
    statfs: async () => ({ bavail: 1, bsize: 4096 }),
  }), (error) => error.code === "QZONE_DISK_SPACE_LOW");
  const result = await assertMinimumFreeSpace("C:\\archive", {
    statfs: async () => ({ bavail: 100000, bsize: 4096 }),
  });
  assert.equal(result.checked, true);
});

test("version comparison follows feature/fix and alpha ordering", () => {
  assert.deepEqual(parseVersion("v0.6.0-alpha").parts, [0, 6, 0]);
  assert.equal(compareVersions("0.6.0", "0.6.0-alpha"), 1);
  assert.equal(compareVersions("0.6.0-alpha", "0.5.9"), 1);
});

test("update checks accept only bounded GitHub release metadata", async () => {
  const releases = [{ tag_name: "v0.6.0-alpha", html_url: "https://github.com/Socialist-Sister/qzone-journal/releases/tag/v0.6.0-alpha", draft: false, prerelease: true, assets: [{ name: "SHA256SUMS.txt" }] }];
  const result = await checkForUpdates("0.5.0-alpha", {
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(releases) }),
  });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.checksumsAvailable, true);
});

test("update checks fall back to the bounded GitHub release feed", async () => {
  const requested = [];
  const result = await checkForUpdates("0.6.1-alpha", {
    fetchImpl: async (url) => {
      requested.push(url);
      if (url === RELEASES_API) throw new TypeError("fetch failed");
      assert.equal(url, RELEASES_ATOM);
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => '<feed><entry><link rel="alternate" href="https://github.com/Socialist-Sister/qzone-journal/releases/tag/v0.6.2-alpha" /></entry></feed>',
      };
    },
  });
  assert.deepEqual(requested, [RELEASES_API, RELEASES_ATOM]);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, "0.6.2-alpha");
  assert.equal(result.checksumsAvailable, false);
});

test("update checks return an actionable error after both GitHub routes fail", async () => {
  await assert.rejects(() => checkForUpdates("0.6.1-alpha", {
    fetchImpl: async () => { throw new TypeError("fetch failed"); },
  }), /无法连接 GitHub 检查更新/);
  assert.equal(validReleaseUrl("https://github.com/Socialist-Sister/qzone-journal/releases/tag/v0.6.2-alpha"), "https://github.com/Socialist-Sister/qzone-journal/releases/tag/v0.6.2-alpha");
  assert.equal(validReleaseUrl("https://github.com/other/repo/releases/tag/v0.6.2-alpha"), "");
});

test("media response is rejected before allocation when declared size is excessive", async () => {
  await assert.rejects(() => readLimitedResponseBody({
    headers: new Headers({ "content-length": String(MAX_MEDIA_BYTES + 1) }),
  }), /80 MB/);
});

test("media allowlist requires an exact QQ host or real subdomain", () => {
  assert.equal(normalizeMediaUrl("https://a.qpic.cn/photo.png"), "https://a.qpic.cn/photo.png");
  assert.equal(normalizeMediaUrl("https://evilqpic.cn/photo.png"), "");
  assert.equal(normalizeMediaUrl("https://photo.store.qq.com.evil.example/photo.png"), "");
});

test("media redirect target is revalidated and safe image succeeds", async () => {
  const common = { ok: true, status: 200, headers: new Headers({ "content-type": "image/png", "content-length": "3" }), body: null, arrayBuffer: async () => Uint8Array.of(1, 2, 3).buffer };
  await assert.rejects(() => downloadMedia({ sourceUrl: "https://a.qpic.cn/test.png", uin: "123456" }, {
    fetch: async () => ({ ...common, url: "https://example.com/redirect.png" }),
  }), /不受信任/);
  const result = await downloadMedia({ sourceUrl: "https://a.qpic.cn/test.png", uin: "123456" }, {
    fetch: async () => ({ ...common, url: "https://b.qpic.cn/final.png" }),
  });
  assert.equal(result.bytes.length, 3);
  assert.equal(result.finalUrl, "https://b.qpic.cn/final.png");
});

test("native QQ videos require a trusted media host, video MIME and a bounded size", async () => {
  const common = { ok: true, status: 200, headers: new Headers({ "content-type": "video/mp4", "content-length": "4" }), body: null, arrayBuffer: async () => Uint8Array.of(0, 0, 0, 1).buffer };
  const result = await downloadMedia({ sourceUrl: "https://photovideo.photo.qq.com/native.mp4", uin: "123456", kind: "video" }, {
    fetch: async () => ({ ...common, url: "https://photovideo.photo.qq.com/native.mp4" }),
  });
  assert.equal(result.contentType, "video/mp4");
  assert.equal(result.bytes.length, 4);
  await assert.rejects(() => downloadMedia({ sourceUrl: "https://photovideo.photo.qq.com/native.mp4", uin: "123456", kind: "video" }, {
    fetch: async () => ({ ...common, headers: new Headers({ "content-type": "image/jpeg", "content-length": "4" }), url: "https://photovideo.photo.qq.com/native.mp4" }),
  }), /媒体响应类型异常/);
  await assert.rejects(() => readLimitedResponseBody({
    headers: new Headers({ "content-length": String(MAX_VIDEO_BYTES + 1) }),
  }, MAX_VIDEO_BYTES, "单个视频"), /256 MB/);
});

test("untrusted redirects are rejected before making the redirected request", async () => {
  let requests = 0;
  await assert.rejects(() => fetchAllowedMedia(async () => {
    requests += 1;
    return { status: 302, headers: new Headers({ location: "http://127.0.0.1/private" }) };
  }, "https://a.qpic.cn/start.png", {}), /不受信任/);
  assert.equal(requests, 1);
});

test("archive schema works in a non-ASCII user path without administrator access", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "空间备份-用户路径-"));
  try {
    const store = new ArchiveStore(root);
    await store.initialize({ ownerUin: "12345678" });
    await store.writeEntry({ sourceId: "chinese-path-1", type: "post", createdAt: "2026-09-01T08:00:00.000Z", text: "中文路径回归", media: [], comments: [], likes: [], metrics: {} });
    assert.equal((await store.summarize()).entries, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("release configuration includes icon, portable archive, checksums and supply-chain metadata", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(__dirname, "..", "package.json"), "utf8"));
  const workflow = await fs.readFile(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");
  const icon = await fs.readFile(path.join(__dirname, "..", "build", "icon.png"));
  assert.ok(parseVersion(packageJson.version), "release version follows the documented version format");
  assert.equal(packageJson.build.win.icon, "build/icon.png");
  assert.match(packageJson.scripts["desktop:dist"], /--publish\s+never/);
  assert.equal(icon.subarray(1, 4).toString("ascii"), "PNG");
  for (const required of ["release:portable", "release:metadata", "SHA256SUMS.txt", "SBOM.cdx.json", "THIRD_PARTY_LICENSES.json", "WINDOWS_CSC_LINK"]) {
    assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});


test("bounded streams await the sink, reject truncation and cancel after disk failure", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(Uint8Array.of(1, 2)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => readLimitedResponseBody(new Response(stream), 10, "媒体", async () => { throw new Error("disk full"); }), /disk full/);
  assert.equal(cancelled, true);
  await assert.rejects(() => readLimitedResponseBody(new Response("abc", { headers: { "content-length": "9" } }), 10), /下载不完整/);
  let written = "";
  const result = await readLimitedResponseBody(new Response("complete"), 20, "媒体", async (chunk) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    written += chunk.toString();
  });
  assert.equal(written, "complete");
  assert.deepEqual(result, { size: 8 });
});

test("completed pagination delays release their cancellation listeners", async () => {
  const { getEventListeners } = require("node:events");
  const { abortableDelay } = require("../desktop/collector/qzone-adapter.cjs");
  const controller = new AbortController();
  for (let index = 0; index < 20; index += 1) await abortableDelay(1, controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const pending = abortableDelay(10000, controller.signal);
  controller.abort();
  await assert.rejects(() => pending);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("media fallback retries transient blocking but never repeats a failed disk write", async () => {
  const attempts = [];
  const response = () => new Response("abc", { headers: { "content-type": "video/mp4", "content-length": "3" } });
  const result = await downloadMedia({ sourceUrl: "https://photovideo.photo.qq.com/a.mp4", uin: "12345678", kind: "video" }, {
    fetch: async (_url, options) => { attempts.push(options.credentials); if (attempts.length === 1) throw new Error("net::ERR_BLOCKED_BY_CLIENT"); return response(); },
  });
  assert.deepEqual(attempts, ["include", "omit"]);
  assert.equal(result.bytes.toString(), "abc");
  let requests = 0;
  await assert.rejects(() => downloadMedia({ sourceUrl: "https://photovideo.photo.qq.com/a.mp4", kind: "video" }, {
    fetch: async () => { requests += 1; return response(); },
    consumeResponse: async () => { throw new Error("disk full"); },
  }), /disk full/);
  assert.equal(requests, 1);
  assert.equal(normalizeMediaUrl("https://user:secret@qpic.cn/a.jpg"), "");
  assert.equal(normalizeMediaUrl("https://qpic.cn:8443/a.jpg"), "");
});


test("release manifests include only the current version and matching update metadata", async () => {
  const { selectReleaseAssets } = await import("../scripts/release-assets.mjs");
  const names = ["QZoneJournal-0.7.0-alpha-x64.exe", "QZoneJournal-0.7.1-alpha-x64.exe", "QZoneJournal-0.7.1-alpha-portable.zip", "latest.yml", "SBOM.cdx.json", "THIRD_PARTY_LICENSES.json"];
  assert.deepEqual(selectReleaseAssets(names, "0.7.1-alpha", "version: 0.7.0-alpha"), ["QZoneJournal-0.7.1-alpha-portable.zip", "QZoneJournal-0.7.1-alpha-x64.exe", "SBOM.cdx.json", "THIRD_PARTY_LICENSES.json"]);
  assert.ok(selectReleaseAssets(names, "0.7.1-alpha", "version: 0.7.1-alpha").includes("latest.yml"));
});


test("fullscreen is granted only to the trusted application main frame", () => {
  const { restrictSessionPermissions } = require("../desktop/security.cjs");
  let check, request;
  const target = { setPermissionCheckHandler: handler => { check = handler; }, setPermissionRequestHandler: handler => { request = handler; } };
  const url = "file:///app/dist/client/index.html";
  const webContents = { getURL: () => url, isDestroyed: () => false };
  restrictSessionPermissions(target, { fullscreenWebContents: webContents, trustedAppUrl: value => value === url });
  const details = { isMainFrame: true, requestingUrl: url };
  assert.equal(check(webContents, "fullscreen", "file://", details), true);
  let granted;
  request(webContents, "fullscreen", value => { granted = value; }, details);
  assert.equal(granted, true);
  for (const permission of ["media", "geolocation", "notifications", "automatic-fullscreen", "clipboard-read"]) assert.equal(check(webContents, permission, "file://", details), false);
  for (const [contents, context] of [[null, details], [{ ...webContents }, details], [webContents, { ...details, isMainFrame: false }], [webContents, { ...details, requestingUrl: "https://user.qzone.qq.com" }], [webContents, {}]]) {
    assert.equal(check(contents, "fullscreen", "file://", context), false);
    request(contents, "fullscreen", value => { granted = value; }, context);
    assert.equal(granted, false);
  }
  restrictSessionPermissions(target);
  assert.equal(check(webContents, "fullscreen", "file://", details), false);
});
