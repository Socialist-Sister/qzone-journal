const { app, dialog, ipcMain, net, shell } = require("electron");
const fs = require("node:fs/promises");
const { checkForUpdates, validReleaseUrl } = require("../update.cjs");
const { exportDiagnosticBundle } = require("../services/diagnostics.cjs");
const { readAppPreferences, setBackupDirectory } = require("../services/preferences.cjs");
const { openExternalHttps, windowFromEvent } = require("../window.cjs");

function registerAppIpc() {
  ipcMain.handle("desktop:window:minimize", (event) => {
    windowFromEvent(event)?.minimize();
  });

  ipcMain.handle("desktop:window:toggle-maximize", (event) => {
    const target = windowFromEvent(event);
    if (!target) return false;
    if (target.isMaximized()) target.unmaximize();
    else target.maximize();
    return target.isMaximized();
  });

  ipcMain.handle("desktop:window:is-maximized", (event) => Boolean(windowFromEvent(event)?.isMaximized()));

  ipcMain.handle("desktop:window:close", (event) => {
    windowFromEvent(event)?.close();
  });

  ipcMain.handle("desktop:dialog:backup-directory", async (event) => {
    const owner = windowFromEvent(event);
    const { backupDirectory } = await readAppPreferences();
    const result = await dialog.showOpenDialog(owner, {
      title: "选择空间备份保存位置",
      defaultPath: backupDirectory,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : setBackupDirectory(result.filePaths[0]);
  });

  ipcMain.handle("desktop:dialog:get-backup-directory", async () => (await readAppPreferences()).backupDirectory);

  ipcMain.handle("desktop:dialog:open-backup-directory", async () => {
    const { backupDirectory } = await readAppPreferences();
    await fs.mkdir(backupDirectory, { recursive: true });
    const errorMessage = await shell.openPath(backupDirectory);
    if (errorMessage) throw new Error(`无法打开备份目录：${errorMessage}`);
    return { opened: true };
  });

  ipcMain.handle("desktop:app:info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
  }));

  ipcMain.handle("desktop:app:check-for-updates", async () => checkForUpdates(app.getVersion(), {
    fetchImpl: net.fetch,
    signal: AbortSignal.timeout(15000),
  }));

  ipcMain.handle("desktop:app:open-release", async (_event, releaseUrl) => {
    const trustedReleaseUrl = validReleaseUrl(releaseUrl);
    if (!trustedReleaseUrl || !openExternalHttps(trustedReleaseUrl)) throw new Error("更新地址未通过安全检查");
    return { opened: true };
  });

  ipcMain.handle("desktop:app:export-diagnostics", async (event) => exportDiagnosticBundle(windowFromEvent(event)));
}

module.exports = { registerAppIpc };
