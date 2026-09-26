// Composition root: services own their state; IPC modules register explicit capabilities.
const { app, BrowserWindow } = require("electron");
const { createMainWindow } = require("./window.cjs");
const { stopCollectors } = require("./services/collector.cjs");
const { registerAppIpc } = require("./ipc/app.cjs");
const { registerArchiveIpc } = require("./ipc/archive.cjs");
const { registerAiIpc } = require("./ipc/ai.cjs");

registerAppIpc();
registerArchiveIpc();
registerAiIpc();

app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopCollectors);
