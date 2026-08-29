const { net } = require("electron");

const parentPort = process.parentPort;
if (!parentPort) throw new Error("media probe worker requires a parent port");

parentPort.on("message", async (event) => {
  const message = event?.data || event;
  try {
    const response = await net.fetch(message.url, {
      credentials: "include",
      headers: { accept: "image/*,*/*;q=0.8", referer: "https://user.qzone.qq.com/" },
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    parentPort.postMessage({ ok: response.ok, status: response.status, contentType: String(response.headers.get("content-type") || "").split(";", 1)[0], bytes: bytes.length });
  } catch (error) {
    parentPort.postMessage({ error: String(error?.message || error) });
  }
});
