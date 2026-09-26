// Reproducible local memory comparison; synthetic media, no QQ account or network.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ArchiveStore } = require("../desktop/archive/store.cjs");
const { readLimitedResponseBody } = require("../desktop/collector/qzone-adapter.cjs");
(async () => {
  const mode = process.argv[2] === "buffered" ? "buffered" : "streamed";
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-media-bench-"));
  try {
    const store = new ArchiveStore(root);
    await store.initialize({ ownerUin: "12345678" });
    const metadata = { sourceUrl: "https://photovideo.photo.qq.com/benchmark.mp4", contentType: "video/mp4" };
    const totalBytes = 64 * 1024 * 1024;
    let produced = 0;
    const sample = () => { peak = Math.max(peak, process.memoryUsage().arrayBuffers); };
    const response = new Response(new ReadableStream({ pull(controller) {
      if (produced === totalBytes) { controller.close(); return; }
      const chunk = new Uint8Array(256 * 1024).fill(7);
      produced += chunk.length;
      controller.enqueue(chunk);
      sample();
    } }), { headers: { "content-length": String(totalBytes) } });
    global.gc?.();
    const baseline = process.memoryUsage().arrayBuffers;
    let peak = baseline;
    const started = performance.now();
    let stored;
    if (mode === "buffered") {
      const bytes = await readLimitedResponseBody(response, totalBytes);
      sample();
      stored = await store.writeMedia({ ...metadata, bytes });
    } else {
      stored = await store.writeMediaStream(metadata, (write) => readLimitedResponseBody(response, totalBytes, "媒体", async chunk => {
        await write(chunk);
        sample();
      }));
    }
    const size = (await fs.stat(path.join(root, stored.relativePath))).size;
    if (size !== totalBytes) throw new Error("Unexpected output size");
    console.log(JSON.stringify({ mode, mediaMiB: size / 1024 / 1024, milliseconds: Math.round(performance.now() - started), peakArrayBufferMiB: +(peak / 1024 / 1024).toFixed(2), incrementalArrayBufferMiB: +((peak - baseline) / 1024 / 1024).toFixed(2) }));
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + "qzone-media-bench-")) throw new Error("Unexpected benchmark path");
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
