const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { isSafeExternalUrl, isTrustedAppUrl, restrictSessionPermissions } = require("./security.cjs");

const DEV_SERVER_URL = process.env.QZONE_JOURNAL_DEV_SERVER_URL || "http://127.0.0.1:4173";
let mainWindow = null;
function trustedAppUrl(targetUrl) {
  return isTrustedAppUrl(targetUrl, {
    packaged: app.isPackaged,
    devServerUrl: DEV_SERVER_URL,
    clientRoot: path.join(__dirname, "..", "dist", "client"),
  });
}

function openExternalHttps(targetUrl) {
  if (!isSafeExternalUrl(targetUrl)) return false;
  void shell.openExternal(targetUrl);
  return true;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 640,
    show: false,
    frame: false,
    title: "空间备份",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    backgroundColor: "#fbf9f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      enableWebSQL: false,
    },
  });

  restrictSessionPermissions(mainWindow.webContents.session, { fullscreenWebContents: mainWindow.webContents, trustedAppUrl });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const sendMaximizedState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:window:maximized-change", mainWindow.isMaximized());
    }
  };
  mainWindow.on("maximize", sendMaximizedState);
  mainWindow.on("unmaximize", sendMaximizedState);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttps(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (trustedAppUrl(url)) return;
    event.preventDefault();
    openExternalHttps(url);
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!input.control || input.type !== "keyDown") return;
    const key = String(input.key || "");
    const current = mainWindow?.webContents.getZoomFactor() || 1;
    if (["+", "=", "Add"].includes(key)) mainWindow?.webContents.setZoomFactor(Math.min(2, current + 0.1));
    else if (["-", "Subtract"].includes(key)) mainWindow?.webContents.setZoomFactor(Math.max(1, current - 0.1));
    else if (["0", "Insert"].includes(key)) mainWindow?.webContents.setZoomFactor(1);
    else return;
    event.preventDefault();
  });

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "client", "index.html"));
  } else {
    void mainWindow.loadURL(DEV_SERVER_URL);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

module.exports = { trustedAppUrl, openExternalHttps, createMainWindow, windowFromEvent };
