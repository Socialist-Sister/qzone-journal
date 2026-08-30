const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("desktop", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  window: Object.freeze({
    minimize: () => invoke("desktop:window:minimize"),
    toggleMaximize: () => invoke("desktop:window:toggle-maximize"),
    isMaximized: () => invoke("desktop:window:is-maximized"),
    onMaximizedChange: (callback) => {
      if (typeof callback !== "function") return () => undefined;
      const listener = (_event, maximized) => callback(Boolean(maximized));
      ipcRenderer.on("desktop:window:maximized-change", listener);
      return () => ipcRenderer.removeListener("desktop:window:maximized-change", listener);
    },
    close: () => invoke("desktop:window:close"),
  }),
  dialogs: Object.freeze({
    getBackupDirectory: () => invoke("desktop:dialog:get-backup-directory"),
    selectBackupDirectory: () => invoke("desktop:dialog:backup-directory"),
    openBackupDirectory: () => invoke("desktop:dialog:open-backup-directory"),
  }),
  app: Object.freeze({
    getInfo: () => invoke("desktop:app:info"),
  }),
  qzone: Object.freeze({
    getSessionStatus: () => invoke("desktop:qzone:get-session-status"),
    listAccounts: () => invoke("desktop:qzone:list-accounts"),
    switchAccount: (accountId) => invoke("desktop:qzone:switch-account", String(accountId || "")),
    addAccount: () => invoke("desktop:qzone:add-account"),
    openLogin: (options = {}) => invoke("desktop:qzone:open-login", { force: options?.force === true }),
    startCollection: (options) => invoke("desktop:qzone:start-collection", options),
    readArchive: () => invoke("desktop:qzone:read-archive"),
    repairArchive: () => invoke("desktop:qzone:repair-archive"),
    cancelCollection: (jobId) => invoke("desktop:qzone:cancel-collection", jobId),
    onCollectorEvent: (callback) => {
      if (typeof callback !== "function") return () => undefined;
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("desktop:qzone:collector-event", listener);
      return () => ipcRenderer.removeListener("desktop:qzone:collector-event", listener);
    },
  }),
  ai: Object.freeze({
    getConfig: () => invoke("desktop:ai:get-config"),
    addProvider: (config) => invoke("desktop:ai:add-provider", config),
    updateProvider: (config) => invoke("desktop:ai:update-provider", config),
    deleteProvider: (providerId) => invoke("desktop:ai:delete-provider", providerId),
    detectModels: (payload) => invoke("desktop:ai:detect-models", payload),
    testConnection: (payload) => invoke("desktop:ai:test-connection", payload),
    generateReview: (payload) => invoke("desktop:ai:generate-review", payload),
    askArchive: (payload) => invoke("desktop:ai:ask-archive", payload),
  }),
}));
