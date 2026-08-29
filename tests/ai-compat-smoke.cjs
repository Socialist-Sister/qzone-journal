const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), "qzone-journal-ai-"));
app.setPath("userData", testUserData);

const requests = [];
global.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  requests.push(body);
  if (requests.length === 1) {
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "", reasoning_content: "已经完成思考，但没有正文" } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: "stop",
      message: { content: [{ type: "text", text: JSON.stringify({
        headline: "兼容重试成功",
        summary: "普通文本模式返回了可读取内容。",
        themes: [{ name: "测试", note: "空响应后自动重试", count: 1 }],
        moments: [{ year: "2025", text: "完成兼容性验证" }],
      }) }] },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });
};

require("../desktop/main.cjs");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL("data:text/html,<title>AI compatibility test</title>");
  const result = await window.webContents.executeJavaScript(`(async () => {
    const config = await window.desktop.ai.addProvider({
      name: "DeepSeek 测试",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-test-only",
      models: ["deepseek-v4-flash"]
    });
    return window.desktop.ai.generateReview({
      selection: { providerId: config.providers[0].id, model: "deepseek-v4-flash" },
      archive: { profileName: "演示", entries: [{ id: "1", type: "post", date: "2025-01-01", text: "测试动态" }] }
    });
  })()`);

  assert.equal(result.review.headline, "兼容重试成功");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].response_format, { type: "json_object" });
  assert.equal(requests[1].response_format, undefined);
  assert.deepEqual(requests[0].thinking, { type: "disabled" });
  assert.equal(requests[0].max_tokens, 3200);
  process.stdout.write(`Electron AI compatibility: ${JSON.stringify({ requests: requests.length, headline: result.review.headline })}\n`);

  for (const openWindow of BrowserWindow.getAllWindows()) openWindow.destroy();
  fs.rmSync(path.join(testUserData, "ai-config.json"), { force: true });
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
