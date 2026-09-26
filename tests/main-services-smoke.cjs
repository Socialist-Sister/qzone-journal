const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const temp = require("node:fs").mkdtempSync(path.join(os.tmpdir(), "qzone-services-"));
app.setPath("userData", path.join(temp, "user"));
app.disableHardwareAcceleration();
require("../desktop/main.cjs");

app.whenReady().then(async () => {
  const { setBackupDirectory } = require("../desktop/services/preferences.cjs");
  const { defaultArchiveRoot, rememberLatestArchive, assertArchiveRoot } = require("../desktop/services/archives.cjs");
  const { getActiveQzoneAccountId } = require("../desktop/qzone-session.cjs");
  const { ArchiveStore } = require("../desktop/archive/store.cjs");
  const directory = path.join(temp, "backups");
  await fs.mkdir(directory, { recursive: true });
  await setBackupDirectory(directory);
  const root = await defaultArchiveRoot("12345678");
  const store = new ArchiveStore(root);
  await store.initialize({ ownerUin: "12345678", jobId: "services", options: { items: ["posts"] } });
  for (let index = 0; index < 3; index++) await store.writeEntry({ sourceId: `post-${index}`, type: "post",
    createdAt: `2025-10-0${index + 1}T00:00:00.000Z`, text: `服务回归 ${index}`, media: [], comments: [], likes: [] });
  await rememberLatestArchive(root, { uin: "12345678", nickname: "本地测试" }, await getActiveQzoneAccountId());
  await assert.rejects(() => assertArchiveRoot(path.join(temp, "outside")), /授权/);
  const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, "..", "desktop", "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  await window.loadURL("data:text/html,<title>Local service integration</title>");
  const result = await window.webContents.executeJavaScript(`(async () => {
    const first = await window.desktop.qzone.readArchive({ limit: 1 });
    const second = await window.desktop.qzone.readArchive({ limit: 1, cursor: first.page.nextCursor });
    const filtered = await window.desktop.qzone.readArchive({ query: "服务回归 0" });
    const accounts = await window.desktop.qzone.listAccounts();
    return { directory: await window.desktop.dialogs.getBackupDirectory(), first, second, filtered, accounts };
  })()`);
  assert.equal(result.directory, directory);
  assert.equal(result.first.entries.length, 1);
  assert.equal(result.first.page.total, 3);
  assert.notEqual(result.first.entries[0].id, result.second.entries[0].id);
  assert.equal(result.filtered.entries.length, 1);
  assert.equal(result.filtered.entries[0].text, "服务回归 0");
  assert.ok(result.accounts.accounts.length);
  console.log("Main services IPC: approved directory, account archive, pagination and search passed");
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
