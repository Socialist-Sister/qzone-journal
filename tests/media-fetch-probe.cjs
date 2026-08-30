const fs = require("node:fs/promises");
const path = require("node:path");
const { app, net, session, utilityProcess } = require("electron");

async function probe(label, fetcher, url, init) {
  try {
    const response = await fetcher(url, init);
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      label,
      ok: response.ok,
      status: response.status,
      contentType: String(response.headers.get("content-type") || "").split(";", 1)[0],
      bytes: bytes.length,
    };
  } catch (error) {
    return { label, error: String(error?.message || error) };
  }
}

function probeWorker(label, options, url) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, "media-fetch-worker.cjs"), [], { ...options, stdio: "ignore", serviceName: `Media Probe ${label}` });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} timed out`));
    }, 20000);
    child.on("message", (message) => {
      clearTimeout(timer);
      child.kill();
      resolve({ label, ...(message?.data || message) });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.postMessage({ url });
  });
}

async function run() {
  const archiveBase = path.join(app.getPath("documents"), "空间备份");
  const directories = await fs.readdir(archiveBase, { withFileTypes: true });
  const candidates = await Promise.all(directories.filter((item) => item.isDirectory()).map(async (item) => {
    const root = path.join(archiveBase, item.name);
    const stat = await fs.stat(root);
    return { root, modified: stat.mtimeMs };
  }));
  candidates.sort((a, b) => b.modified - a.modified);
  const diagnostic = JSON.parse(await fs.readFile(path.join(candidates[0].root, "diagnostics", "media-download-failures.json"), "utf8"));
  const url = String(diagnostic.items?.[0]?.sourceUrl || "");
  if (!url) throw new Error("没有可探测的媒体地址");
  const headers = { accept: "image/*,*/*;q=0.8", referer: "https://user.qzone.qq.com/" };
  const qzoneSession = session.fromPartition("qzone-journal-account", { cache: true });
  const results = [];
  results.push(await probe("net-anonymous", net.fetch, url, { headers }));
  results.push(await probe("net-credentials", net.fetch, url, { credentials: "include", headers }));
  results.push(await probe("session-anonymous", qzoneSession.fetch.bind(qzoneSession), url, { headers }));
  results.push(await probe("session-credentials", qzoneSession.fetch.bind(qzoneSession), url, { credentials: "include", headers }));
  results.push(await probeWorker("utility-session", { session: qzoneSession }, url));
  results.push(await probeWorker("utility-partition", { partition: "qzone-journal-account" }, url));
  qzoneSession.setPermissionCheckHandler(() => false);
  qzoneSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  results.push(await probeWorker("utility-session-permissions-denied", { session: qzoneSession }, url));
  process.stdout.write(`${JSON.stringify(results)}\n`);
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
