const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { isSafeExternalUrl, isTrustedAppUrl } = require("../desktop/security.cjs");
const { assertMinimumFreeSpace } = require("../desktop/storage-safety.cjs");
const { checkForUpdates, compareVersions, parseVersion } = require("../desktop/update.cjs");
const { MAX_MEDIA_BYTES, downloadMedia, fetchAllowedMedia, readLimitedResponseBody } = require("../desktop/collector/qzone-adapter.cjs");
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
  assert.equal(packageJson.version, "0.6.1-alpha");
  assert.equal(packageJson.build.win.icon, "build/icon.png");
  assert.equal(icon.subarray(1, 4).toString("ascii"), "PNG");
  for (const required of ["release:portable", "release:metadata", "SHA256SUMS.txt", "SBOM.cdx.json", "THIRD_PARTY_LICENSES.json", "WINDOWS_CSC_LINK"]) {
    assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
