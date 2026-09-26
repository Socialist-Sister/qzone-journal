const { ipcMain } = require("electron");
const { addQzoneAccount, inspectQzoneSession, openQzoneLogin, publicSessionStatus, switchQzoneAccount } = require("../qzone-session.cjs");
const { readLatestArchive, repairLatestArchive, listAccountsWithArchives, deleteAccountData } = require("../services/archives.cjs");
const { startCollectorJob, isCollecting, cancelCollection } = require("../services/collector.cjs");
const { exportLatestArchive } = require("../services/exports.cjs");
const { windowFromEvent } = require("../window.cjs");

function registerArchiveIpc() {
  ipcMain.handle("desktop:qzone:get-session-status", async () => publicSessionStatus(await inspectQzoneSession({ validate: true })));

  ipcMain.handle("desktop:qzone:list-accounts", async () => listAccountsWithArchives());

  ipcMain.handle("desktop:qzone:switch-account", async (_event, accountId) => {
    if (isCollecting()) throw new Error("备份进行中，完成或取消后才能切换账号");
    const result = await switchQzoneAccount(accountId);
    return { ...(await listAccountsWithArchives()), sessionStatus: result.sessionStatus };
  });

  ipcMain.handle("desktop:qzone:add-account", async (event) => {
    if (isCollecting()) throw new Error("备份进行中，完成或取消后才能添加账号");
    const result = await addQzoneAccount(windowFromEvent(event));
    return { ...(await listAccountsWithArchives()), sessionStatus: result.sessionStatus };
  });

  ipcMain.handle("desktop:qzone:delete-account", async (_event, accountId) => {
    if (isCollecting()) throw new Error("备份进行中，完成或取消后才能删除账号");
    return deleteAccountData(accountId);
  });

  ipcMain.handle("desktop:qzone:open-login", async (event, input = {}) => openQzoneLogin(windowFromEvent(event), {
    force: input?.force === true,
  }));

  ipcMain.handle("desktop:qzone:start-collection", async (event, input) => startCollectorJob(event.sender, input));

  ipcMain.handle("desktop:qzone:read-archive", async (_event, input = {}) => readLatestArchive(undefined, {
    cursor: String(input?.cursor || ""),
    limit: Math.min(300, Math.max(1, Number(input?.limit) || 100)),
    query: String(input?.query || "").slice(0, 200),
    type: ["post", "journal", "album"].includes(input?.type) ? input.type : "all",
  }));

  ipcMain.handle("desktop:qzone:export-archive", async (event, input = {}) => (
    exportLatestArchive(event.sender, windowFromEvent(event), input)
  ));

  ipcMain.handle("desktop:qzone:repair-archive", async () => {
    if (isCollecting()) throw new Error("备份进行中，完成或取消后才能检查档案");
    return repairLatestArchive();
  });

  ipcMain.handle("desktop:qzone:cancel-collection", (_event, jobId) => cancelCollection(jobId));
}

module.exports = { registerArchiveIpc };
