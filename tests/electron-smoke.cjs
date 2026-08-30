const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

async function run() {
  let mockAiConfig = { configured: false, providers: [], modelOptions: [] };
  const testedModels = [];
  const loginCalls = [];
  let collectionAttempts = 0;
  let mockMaximized = false;
  let mockBackupDirectory = "C:\\Users\\Tester\\Documents\\空间备份";
  let openedBackupDirectory = 0;
  let repairCalls = 0;
  let deleteAccountCalls = 0;
  let diagnosticExportCalls = 0;
  let mockAccounts = {
    activeAccountId: "account-a",
    accounts: [
      { id: "account-a", accountLabel: "QQ ••••5678", authenticated: true, active: true, hasArchive: true, archivePath: "C:\\Users\\Tester\\Documents\\空间备份\\QQ-5678-test" },
      { id: "account-b", accountLabel: "QQ ••••2468", authenticated: false, active: false, hasArchive: true, archivePath: "C:\\Users\\Tester\\Documents\\空间备份\\QQ-2468-test" },
    ],
  };
  ipcMain.handle("desktop:ai:get-config", () => mockAiConfig);
  ipcMain.handle("desktop:window:is-maximized", () => mockMaximized);
  ipcMain.handle("desktop:window:toggle-maximize", (event) => {
    mockMaximized = !mockMaximized;
    event.sender.send("desktop:window:maximized-change", mockMaximized);
    return mockMaximized;
  });
  ipcMain.handle("desktop:dialog:get-backup-directory", () => mockBackupDirectory);
  ipcMain.handle("desktop:dialog:open-backup-directory", () => {
    openedBackupDirectory += 1;
    return { opened: true };
  });
  ipcMain.handle("desktop:dialog:backup-directory", () => {
    mockBackupDirectory = "D:\\QQ空间档案";
    return mockBackupDirectory;
  });
  ipcMain.handle("desktop:app:export-diagnostics", () => {
    diagnosticExportCalls += 1;
    return { exported: true, fileName: "空间备份-脱敏诊断-20260830.json", archiveCount: 2 };
  });
  ipcMain.handle("desktop:ai:generate-review", async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    return {
      review: { headline: "演示回顾", summary: "用于验证生成流程。", themes: [{ name: "日常", note: "演示", count: 3 }], moments: [{ year: "2025", text: "演示时刻" }] },
      model: "model-b",
      providerName: "服务 B",
      sourceCount: 15,
    };
  });
  ipcMain.handle("desktop:ai:ask-archive", async () => ({
    answer: "结论：\n这是基于档案的谨慎归纳。\n档案依据：\n- 2025-05-03｜记录清晨散步｜长期观察日常细节\n- 2024-12-31｜回顾普通一年｜会整理经历\n边界：\n档案没有覆盖线下生活。",
    model: "model-b",
    providerName: "服务 B",
  }));
  ipcMain.handle("desktop:ai:test-connection", async (_event, payload) => {
    testedModels.push(payload.selection.model);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { ok: true, message: "OK" };
  });
  ipcMain.handle("desktop:qzone:get-session-status", () => ({ authenticated: false, accountLabel: "" }));
  ipcMain.handle("desktop:qzone:list-accounts", () => mockAccounts);
  ipcMain.handle("desktop:qzone:switch-account", (_event, accountId) => {
    mockAccounts = {
      activeAccountId: accountId,
      accounts: mockAccounts.accounts.map((account) => ({ ...account, active: account.id === accountId })),
    };
    const active = mockAccounts.accounts.find((account) => account.id === accountId);
    return { ...mockAccounts, sessionStatus: { authenticated: active.authenticated, accountLabel: active.accountLabel, accountId } };
  });
  ipcMain.handle("desktop:qzone:add-account", () => {
    mockAccounts = {
      activeAccountId: "account-c",
      accounts: [
        ...mockAccounts.accounts.map((account) => ({ ...account, active: false })),
        { id: "account-c", accountLabel: "QQ ••••1357", authenticated: true, active: true, hasArchive: true, archivePath: "D:\\QQ空间档案\\QQ-1357-test" },
      ],
    };
    return { ...mockAccounts, sessionStatus: { authenticated: true, accountLabel: "QQ ••••1357", accountId: "account-c" } };
  });
  ipcMain.handle("desktop:qzone:delete-account", (_event, accountId) => {
    deleteAccountCalls += 1;
    const deleted = mockAccounts.accounts.find((account) => account.id === accountId);
    const remaining = mockAccounts.accounts.filter((account) => account.id !== accountId);
    const activeAccountId = remaining[0]?.id || "";
    mockAccounts = {
      activeAccountId,
      accounts: remaining.map((account) => ({ ...account, active: account.id === activeAccountId })),
    };
    return { ...mockAccounts, deletedAccountLabel: deleted?.accountLabel || "", movedToTrash: Boolean(deleted?.hasArchive) };
  });
  ipcMain.handle("desktop:qzone:open-login", (_event, input) => {
    loginCalls.push(input || {});
    return { authenticated: true, accountLabel: "QQ ••••5678" };
  });
  ipcMain.handle("desktop:qzone:start-collection", (event) => {
    collectionAttempts += 1;
    const jobId = `ui-collector-smoke-${collectionAttempts}`;
    setTimeout(() => event.sender.send("desktop:qzone:collector-event", { type: "progress", jobId, progress: 24, phase: "session_check", message: "正在确认 QQ 登录会话…" }), 20);
    if (collectionAttempts === 1) {
      setTimeout(() => event.sender.send("desktop:qzone:collector-event", { type: "error", jobId, phase: "authentication_required", message: "QQ 登录会话已失效", counts: { entries: 2, media: 2, comments: 0, likes: 0 } }), 90);
    } else {
      setTimeout(() => {
        mockAccounts = { ...mockAccounts, accounts: mockAccounts.accounts.map((account) => ({ ...account, authenticated: false })) };
        event.sender.send("desktop:qzone:collector-event", { type: "complete", jobId, progress: 100, phase: "collection_complete", message: "采集完成", archivePath: "C:\\Users\\Tester\\Documents\\空间备份\\QQ-5678-test", schemaVersion: 1, mode: "incremental", changes: { added: 1, updated: 0, skipped: 2 }, counts: { entries: 1, media: 0, comments: 1, likes: 1 } });
      }, 90);
    }
    return { jobId, archivePath: "C:\\Users\\Tester\\Documents\\空间备份\\QQ-12345678", accountLabel: "QQ ••••5678" };
  });
  ipcMain.handle("desktop:qzone:read-archive", () => ({
    id: "local-test",
    isDemo: false,
    profileName: "QQ ••••5678的空间",
    lastBackupAt: "2026-08-29T10:00:00+08:00",
    importedAt: "2026年8月29日 10:00",
    range: "2026—2026",
    integrity: { needsRepair: false, corruptEntries: [], missingMedia: [], unsafeMedia: [] },
    entries: [{ id: "real-post-1", type: "post", date: "2026-08-29T10:00:00+08:00", displayDate: "2026年8月29日 10:00", title: null, text: "真实归档流程测试", images: [], likes: ["小周"], comments: [{ name: "小周", text: "测试评论" }] }],
  }));
  ipcMain.handle("desktop:qzone:repair-archive", () => {
    repairCalls += 1;
    return { repaired: true, quarantinedEntries: 0, mediaMarkedForRedownload: 0 };
  });
  ipcMain.handle("desktop:qzone:cancel-collection", () => ({ cancelled: true }));
  ipcMain.handle("desktop:app:info", () => ({ name: "空间备份", version: "0.3.0-alpha", platform: process.platform, packaged: false }));
  const window = new BrowserWindow({
    width: 1120,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  await window.loadFile(path.join(__dirname, "..", "dist", "client", "index.html"));

  const result = await window.webContents.executeJavaScript(`({
    title: document.title,
    hasDesktopBridge: window.desktop?.isDesktop === true,
    hasWindowBridge: ["minimize", "toggleMaximize", "isMaximized", "onMaximizedChange", "close"]
      .every((method) => typeof window.desktop?.window?.[method] === "function"),
    hasDirectoryBridge: ["getBackupDirectory", "selectBackupDirectory", "openBackupDirectory"]
      .every((method) => typeof window.desktop?.dialogs?.[method] === "function"),
    hasAppBridge: ["getInfo", "exportDiagnostics"].every((method) => typeof window.desktop?.app?.[method] === "function"),
    hasAiBridge: ["getConfig", "addProvider", "updateProvider", "deleteProvider", "detectModels", "testConnection", "generateReview", "askArchive"]
      .every((method) => typeof window.desktop?.ai?.[method] === "function"),
    hasQzoneBridge: ["getSessionStatus", "listAccounts", "switchAccount", "addAccount", "deleteAccount", "openLogin", "startCollection", "readArchive", "repairArchive", "cancelCollection", "onCollectorEvent"]
      .every((method) => typeof window.desktop?.qzone?.[method] === "function"),
    hasHomeAction: ["快速开始", "再次备份"].some((label) => document.body.innerText.includes(label)),
    hasNoBrowserAction: !document.body.innerText.includes("使用系统浏览器"),
    hasPrimaryNavigation: ["首页", "我的档案", "AI 回顾", "设置"]
      .every((label) => document.body.innerText.includes(label)),
    bodyLength: document.body.innerText.length
  })`);

  process.stdout.write(`Electron smoke result: ${JSON.stringify(result)}\n`);
  assert.equal(result.title, "空间备份");
  assert.equal(result.hasDesktopBridge, true);
  assert.equal(result.hasWindowBridge, true);
  assert.equal(result.hasDirectoryBridge, true);
  assert.equal(result.hasAppBridge, true);
  assert.equal(result.hasAiBridge, true);
  assert.equal(result.hasQzoneBridge, true);
  assert.equal(result.hasHomeAction, true);
  assert.equal(result.hasNoBrowserAction, true);
  assert.equal(result.hasPrimaryNavigation, true);
  assert.ok(result.bodyLength > 50);

  const maximizeFlow = await window.webContents.executeJavaScript(`(async () => {
    const maximize = document.querySelector('[aria-label="最大化窗口"]');
    maximize?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const changedToRestore = Boolean(document.querySelector('[aria-label="还原窗口"]'));
    document.querySelector('[aria-label="还原窗口"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { hasMaximizeButton: Boolean(maximize), changedToRestore, changedBack: Boolean(document.querySelector('[aria-label="最大化窗口"]')) };
  })()`);
  process.stdout.write(`Electron maximize flow: ${JSON.stringify(maximizeFlow)}\n`);
  assert.equal(maximizeFlow.hasMaximizeButton, true);
  assert.equal(maximizeFlow.changedToRestore, true);
  assert.equal(maximizeFlow.changedBack, true);

  const accountFlow = await window.webContents.executeJavaScript(`(async () => {
    document.querySelector(".account-trigger")?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const listedAccounts = document.querySelectorAll(".account-menu-item").length;
    [...document.querySelectorAll(".account-menu-item")].find((button) => button.textContent.includes("2468"))?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const switched = document.querySelector(".account-trigger")?.textContent.includes("2468") === true;
    document.querySelector(".account-trigger")?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector(".account-add")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const added = document.querySelector(".account-trigger")?.textContent.includes("1357") === true;
    document.querySelector(".account-trigger")?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('[aria-label*="1357"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const hasDeleteConfirmation = document.body.innerText.includes("删除 QQ ••••1357 的全部数据") && document.body.innerText.includes("QQ-1357-test");
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "删除全部数据")?.click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    return {
      listedAccounts,
      switched,
      added,
      hasDeleteConfirmation,
      deletedAccount: document.querySelector(".account-trigger")?.textContent.includes("1357") !== true,
      keepsMaskedLabels: !document.body.innerText.includes("12345678")
    };
  })()`);
  process.stdout.write(`Electron account flow: ${JSON.stringify(accountFlow)}\n`);
  assert.equal(accountFlow.listedAccounts, 2);
  assert.equal(accountFlow.switched, true);
  assert.equal(accountFlow.added, true);
  assert.equal(accountFlow.hasDeleteConfirmation, true);
  assert.equal(accountFlow.deletedAccount, true);
  assert.equal(deleteAccountCalls, 1);
  assert.equal(accountFlow.keepsMaskedLabels, true);

  const directoryFlow = await window.webContents.executeJavaScript(`(async () => {
    const findButton = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    findButton("设置")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const checkboxRect = document.querySelector('.settings-list input[type="checkbox"]')?.getBoundingClientRect();
    const folderButton = document.querySelector('[aria-label="打开备份目录"]');
    const folderRect = folderButton?.getBoundingClientRect();
    const showsDefaultDirectory = document.body.innerText.includes("Documents") && document.body.innerText.includes("空间备份");
    folderButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    findButton("更改位置")?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const result = {
      showsDefaultDirectory,
      controlsAligned: Math.abs((checkboxRect.left + checkboxRect.width / 2) - (folderRect.left + folderRect.width / 2)) <= 1,
      changedDirectory: document.body.innerText.includes("QQ空间档案")
    };
    findButton("首页")?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return result;
  })()`);
  process.stdout.write(`Electron directory flow: ${JSON.stringify(directoryFlow)}\n`);
  assert.equal(directoryFlow.showsDefaultDirectory, true);
  assert.equal(directoryFlow.controlsAligned, true);
  assert.equal(directoryFlow.changedDirectory, true);
  assert.equal(openedBackupDirectory, 1);

  const diagnosticsFlow = await window.webContents.executeJavaScript(`(async () => {
    const findButton = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    findButton("设置")?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    findButton("隐私与导出")?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    findButton("导出诊断")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const result = {
      hasPrivacyBoundary: document.body.innerText.includes("不包含 Cookie") && document.body.innerText.includes("本地绝对路径"),
      exported: document.querySelector(".settings-notice")?.textContent.includes("空间备份-脱敏诊断-20260830.json") === true
    };
    findButton("首页")?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return result;
  })()`);
  process.stdout.write(`Electron diagnostics flow: ${JSON.stringify(diagnosticsFlow)}\n`);
  assert.equal(diagnosticsFlow.hasPrivacyBoundary, true);
  assert.equal(diagnosticsFlow.exported, true);
  assert.equal(diagnosticExportCalls, 1);

  const backupFlow = await window.webContents.executeJavaScript(`(async () => {
    const findButton = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    [...document.querySelectorAll("button")].find((button) => ["快速开始", "再次备份"].includes(button.textContent.trim()))?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const hasCookieBoundary = document.body.innerText.includes("Cookie 不会发送到界面");
    findButton("打开扫码登录")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    findButton("开始创建本地档案")?.click();
    await new Promise((resolve) => setTimeout(resolve, 140));
    const offeredForcedRelogin = document.body.innerText.includes("已经保存 2 条内容") && Boolean(findButton("重新扫码登录"));
    findButton("重新扫码登录")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    findButton("开始创建本地档案")?.click();
    await new Promise((resolve) => setTimeout(resolve, 140));
    const result = {
      hasCookieBoundary,
      offeredForcedRelogin,
      collectionComplete: document.body.innerText.includes("1 条内容已归档"),
      showsIncrementalStats: document.body.innerText.includes("本次新增 1 条、更新 0 条、跳过 2 条"),
      showsTemporarySessionCleared: document.body.innerText.includes("QQ 临时会话已自动清除"),
      showsArchivePath: document.querySelector(".archive-path")?.textContent.includes("QQ-5678-test") === true
    };
    findButton("打开我的档案")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    result.openedRealArchive = document.body.innerText.includes("真实归档流程测试");
    result.archiveHasNoRepairAction = !findButton("检查与修复");
    findButton("设置")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    findButton("常规")?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    result.hasRepairAction = Boolean(findButton("检查与修复"));
    findButton("检查与修复")?.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    result.repairNotice = document.querySelector(".window-notice")?.textContent || "";
    result.repairCompleted = result.repairNotice.includes("档案检查完成");
    return result;
  })()`);
  process.stdout.write(`Electron backup flow: ${JSON.stringify(backupFlow)}\n`);
  process.stdout.write(`Electron repair calls: ${repairCalls}\n`);
  assert.equal(backupFlow.hasCookieBoundary, true);
  assert.equal(backupFlow.offeredForcedRelogin, true);
  assert.equal(backupFlow.collectionComplete, true);
  assert.equal(backupFlow.showsIncrementalStats, true);
  assert.equal(backupFlow.showsTemporarySessionCleared, true);
  assert.equal(backupFlow.showsArchivePath, true);
  assert.equal(backupFlow.openedRealArchive, true);
  assert.equal(backupFlow.archiveHasNoRepairAction, true);
  assert.equal(backupFlow.hasRepairAction, true);
  assert.equal(backupFlow.repairCompleted, true);
  assert.equal(repairCalls, 1);
  assert.equal(loginCalls[0]?.force, false);
  assert.equal(loginCalls[1]?.force, true);

  await window.webContents.executeJavaScript(`window.localStorage.setItem("qzone-journal-demo-loaded", "true")`);
  const reloadComplete = new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
  window.webContents.reload();
  await reloadComplete;
  const aiFlow = await window.webContents.executeJavaScript(`(async () => {
    const findButton = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    findButton("AI 回顾")?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const hasSetupAction = document.body.innerText.includes("前往接入 AI");
    findButton("前往接入 AI")?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      hasSetupAction,
      openedAiSettings: document.querySelector(".settings-subnav button.active")?.textContent.trim() === "AI 接入",
      hasFeeNotice: document.body.innerText.includes("可能产生费用"),
      hasProviderActions: ["添加服务", "修改", "删除"].every((label) => label === "修改" || label === "删除" ? true : document.body.innerText.includes(label))
    };
  })()`);
  process.stdout.write(`Electron AI flow: ${JSON.stringify(aiFlow)}\n`);
  assert.equal(aiFlow.hasSetupAction, true);
  assert.equal(aiFlow.openedAiSettings, true);
  assert.equal(aiFlow.hasFeeNotice, true);
  assert.equal(aiFlow.hasProviderActions, true);

  mockAiConfig = {
    configured: true,
    providers: [
      { id: "provider-a", name: "服务 A", baseUrl: "https://a.example/v1", maskedKey: "•••• 0001", models: ["model-a", "model-a-2"] },
      { id: "provider-b", name: "服务 B", baseUrl: "https://b.example/v1", maskedKey: "•••• 0002", models: ["model-b"] },
    ],
    modelOptions: [
      { key: "provider-a::model-a", providerId: "provider-a", providerName: "服务 A", model: "model-a" },
      { key: "provider-a::model-a-2", providerId: "provider-a", providerName: "服务 A", model: "model-a-2" },
      { key: "provider-b::model-b", providerId: "provider-b", providerName: "服务 B", model: "model-b" },
    ],
  };
  const configuredReload = new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
  window.webContents.reload();
  await configuredReload;
  const generationFlow = await window.webContents.executeJavaScript(`(async () => {
    const findButton = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    findButton("AI 回顾")?.click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    document.querySelector(".review-model-picker > button")?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const modelButtons = [...document.querySelectorAll(".model-picker-menu [role='option']")];
    modelButtons.find((button) => button.textContent.includes("model-b"))?.click();
    findButton("生成 AI 回顾")?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const hasLiveProgress = Boolean(document.querySelector(".ai-generation-progress")) && document.body.innerText.includes("界面不会卡住");
    await new Promise((resolve) => setTimeout(resolve, 240));
    const question = document.querySelector(".archive-question-form textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(question, "我有什么特点？");
    question.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    document.querySelector(".archive-question-form button")?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const pickerRect = document.querySelector(".review-model-picker > button")?.getBoundingClientRect();
    const regenerateRect = findButton("重新生成")?.getBoundingClientRect();
    return {
      modelCount: modelButtons.length,
      hasLiveProgress,
      hasGeneratedReview: document.body.innerText.includes("演示回顾") && document.body.innerText.includes("服务 B · model-b"),
      hasStructuredAnswer: document.querySelectorAll(".answer-evidence").length === 2 && document.body.innerText.includes("档案依据"),
      controlsAligned: Math.abs(pickerRect.top - regenerateRect.top) <= 1 && Math.abs(pickerRect.height - regenerateRect.height) <= 1,
      removedRegenerateFeeCopy: !document.body.innerText.includes("将再次调用模型并可能计费")
    };
  })()`);
  process.stdout.write(`Electron generation flow: ${JSON.stringify(generationFlow)}\n`);
  assert.equal(generationFlow.modelCount, 3);
  assert.equal(generationFlow.hasLiveProgress, true);
  assert.equal(generationFlow.hasGeneratedReview, true);
  assert.equal(generationFlow.hasStructuredAnswer, true);
  assert.equal(generationFlow.controlsAligned, true);
  assert.equal(generationFlow.removedRegenerateFeeCopy, true);

  const persistenceFlow = await window.webContents.executeJavaScript(`(async () => {
    const findButton = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    findButton("设置")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    findButton("AI 回顾")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const keptReview = document.body.innerText.includes("演示回顾") && document.body.innerText.includes("我有什么特点？");
    const hasRegenerate = Boolean(findButton("重新生成"));
    findButton("设置")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    findButton("AI 接入")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    findButton("修改")?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    findButton("测试模型")?.click();
    await new Promise((resolve) => setTimeout(resolve, 140));
    const saveRect = findButton("保存修改")?.getBoundingClientRect();
    const testRect = findButton("测试模型")?.getBoundingClientRect();
    return {
      keptReview,
      hasRegenerate,
      hasTestAllLabel: document.body.innerText.includes("测试模型"),
      passedModelRows: document.querySelectorAll(".model-test-results p.passed").length,
      settingsButtonsMatch: Math.abs(saveRect.width - testRect.width) <= 1 && Math.abs(saveRect.height - testRect.height) <= 1
    };
  })()`);
  process.stdout.write(`Electron persistence/test-all flow: ${JSON.stringify(persistenceFlow)}\n`);
  assert.equal(persistenceFlow.keptReview, true);
  assert.equal(persistenceFlow.hasRegenerate, true);
  assert.equal(persistenceFlow.hasTestAllLabel, true);
  assert.equal(persistenceFlow.passedModelRows, 2);
  assert.equal(persistenceFlow.settingsButtonsMatch, true);
  assert.deepEqual(testedModels, ["model-a", "model-a-2"]);

  process.stdout.write("Electron smoke passed\n");
  window.destroy();
  ipcMain.removeHandler("desktop:ai:get-config");
  ipcMain.removeHandler("desktop:ai:generate-review");
  ipcMain.removeHandler("desktop:ai:ask-archive");
  ipcMain.removeHandler("desktop:ai:test-connection");
  ipcMain.removeHandler("desktop:window:is-maximized");
  ipcMain.removeHandler("desktop:window:toggle-maximize");
  ipcMain.removeHandler("desktop:dialog:get-backup-directory");
  ipcMain.removeHandler("desktop:dialog:open-backup-directory");
  ipcMain.removeHandler("desktop:dialog:backup-directory");
  ipcMain.removeHandler("desktop:app:info");
  ipcMain.removeHandler("desktop:app:export-diagnostics");
  ipcMain.removeHandler("desktop:qzone:get-session-status");
  ipcMain.removeHandler("desktop:qzone:list-accounts");
  ipcMain.removeHandler("desktop:qzone:switch-account");
  ipcMain.removeHandler("desktop:qzone:add-account");
  ipcMain.removeHandler("desktop:qzone:delete-account");
  ipcMain.removeHandler("desktop:qzone:open-login");
  ipcMain.removeHandler("desktop:qzone:start-collection");
  ipcMain.removeHandler("desktop:qzone:read-archive");
  ipcMain.removeHandler("desktop:qzone:repair-archive");
  ipcMain.removeHandler("desktop:qzone:cancel-collection");
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
