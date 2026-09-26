import { useEffect, useState } from "react";
import { loadSavedArchive, rememberDemoArchive } from "../domain/demoArchive.js";
import { readableError } from "../lib/presentation.js";
import { demoArchive } from "../mockArchive.js";

function useAppController() {
  const [activeView, setActiveView] = useState("home");
  const [settingsSection, setSettingsSection] = useState("general");
  const [dialogMethod, setDialogMethod] = useState(null);
  const [demoDialogOpen, setDemoDialogOpen] = useState(false);
  const [archiveData, setArchiveData] = useState(loadSavedArchive);
  const [aiConfig, setAiConfig] = useState({ configured: false, providers: [], modelOptions: [] });
  const [accountState, setAccountState] = useState({ activeAccountId: "", accounts: [] });
  const [accountBusy, setAccountBusy] = useState(false);
  const [archiveRepairing, setArchiveRepairing] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowNotice, setWindowNotice] = useState("");

  useEffect(() => {
    if (!window.desktop?.ai?.getConfig) return;
    window.desktop.ai.getConfig().then(setAiConfig).catch((error) => {
      setWindowNotice(readableError(error));
      window.setTimeout(() => setWindowNotice(""), 3000);
    });
  }, []);

  const refreshAccounts = async () => {
    if (!window.desktop?.qzone?.listAccounts) return accountState;
    const next = await window.desktop.qzone.listAccounts();
    setAccountState(next);
    if (window.desktop?.qzone?.readArchive) {
      const archive = await window.desktop.qzone.readArchive();
      setArchiveData(archive || null);
    }
    return next;
  };

  useEffect(() => {
    if (!window.desktop?.qzone?.readArchive) return undefined;
    let active = true;
    Promise.resolve(window.desktop.qzone.listAccounts?.())
      .then((accounts) => {
        if (active && accounts) setAccountState(accounts);
        return window.desktop.qzone.readArchive();
      })
      .then((archive) => {
        if (active && archive) setArchiveData(archive);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    window.desktop?.window?.isMaximized?.().then((value) => {
      if (active) setIsMaximized(Boolean(value));
    }).catch(() => undefined);
    const unsubscribe = window.desktop?.window?.onMaximizedChange?.((value) => setIsMaximized(value));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const loadActiveArchive = async () => {
    const archive = await window.desktop?.qzone?.readArchive?.();
    setArchiveData(archive || null);
    return archive;
  };

  const handleRepairArchive = async () => {
    if (archiveRepairing || !window.desktop?.qzone?.repairArchive) {
      if (!window.desktop?.qzone?.repairArchive) {
        setWindowNotice("档案检查仅在桌面版中可用");
        window.setTimeout(() => setWindowNotice(""), 2500);
      }
      return;
    }
    setArchiveRepairing(true);
    try {
      const result = await window.desktop.qzone.repairArchive();
      await loadActiveArchive();
      const repaired = (result.quarantinedEntries || 0) + (result.repairedEntries || 0);
      setWindowNotice(repaired ? `档案修复完成：处理了 ${repaired} 条记录` : "档案检查完成，未发现需要修复的问题");
    } catch (error) {
      setWindowNotice(readableError(error));
    } finally {
      setArchiveRepairing(false);
      window.setTimeout(() => setWindowNotice(""), 3500);
    }
  };

  const handleSwitchAccount = async (accountId) => {
    if (accountBusy || accountId === accountState.activeAccountId) return;
    if (!window.desktop?.qzone?.switchAccount) {
      setWindowNotice("账号切换仅在桌面版中可用");
      window.setTimeout(() => setWindowNotice(""), 2500);
      return;
    }
    setAccountBusy(true);
    try {
      const next = await window.desktop.qzone.switchAccount(accountId);
      setAccountState({ activeAccountId: next.activeAccountId, accounts: next.accounts });
      await loadActiveArchive();
      setWindowNotice(next.sessionStatus?.authenticated ? `已切换到 ${next.sessionStatus.accountLabel}` : "已切换账号；备份前需要重新扫码");
    } catch (error) {
      setWindowNotice(readableError(error));
    } finally {
      setAccountBusy(false);
      window.setTimeout(() => setWindowNotice(""), 3000);
    }
  };

  const handleAddAccount = async () => {
    if (accountBusy || !window.desktop?.qzone?.addAccount) {
      if (!window.desktop?.qzone?.addAccount) {
        setWindowNotice("添加账号仅在桌面版中可用");
        window.setTimeout(() => setWindowNotice(""), 2500);
      }
      return;
    }
    setAccountBusy(true);
    try {
      const next = await window.desktop.qzone.addAccount();
      setAccountState({ activeAccountId: next.activeAccountId, accounts: next.accounts });
      if (next.sessionStatus?.authenticated) {
        await loadActiveArchive();
        setWindowNotice(`已添加并切换到 ${next.sessionStatus.accountLabel}`);
      }
    } catch (error) {
      setWindowNotice(readableError(error));
    } finally {
      setAccountBusy(false);
      window.setTimeout(() => setWindowNotice(""), 3000);
    }
  };

  const handleDeleteAccount = async (accountId) => {
    if (accountBusy || !window.desktop?.qzone?.deleteAccount) {
      if (!window.desktop?.qzone?.deleteAccount) {
        setWindowNotice("账号数据删除仅在桌面版中可用");
        window.setTimeout(() => setWindowNotice(""), 2800);
      }
      return false;
    }
    setAccountBusy(true);
    try {
      const next = await window.desktop.qzone.deleteAccount(accountId);
      setAccountState({ activeAccountId: next.activeAccountId, accounts: next.accounts });
      await loadActiveArchive();
      setWindowNotice(next.movedToTrash ? `${next.deletedAccountLabel} 的本地档案已移入回收站` : `${next.deletedAccountLabel} 的账号数据已删除`);
      return true;
    } catch (error) {
      setWindowNotice(readableError(error));
      return false;
    } finally {
      setAccountBusy(false);
      window.setTimeout(() => setWindowNotice(""), 3500);
    }
  };

  const start = (method = "app") => setDialogMethod(method);
  const complete = (collectedArchive) => {
    const nextArchive = collectedArchive?.entries
      ? collectedArchive
      : { ...demoArchive, lastBackupAt: new Date().toISOString() };
    setArchiveData(nextArchive);
    if (nextArchive.isDemo) rememberDemoArchive(nextArchive);
    setDialogMethod(null);
    setActiveView("archive");
  };
  const completeDemoImport = () => {
    const nextArchive = { ...demoArchive, lastBackupAt: new Date().toISOString() };
    setArchiveData(nextArchive);
    rememberDemoArchive(nextArchive);
    setDemoDialogOpen(false);
    setActiveView("archive");
  };

  const openAiSettings = () => {
    setSettingsSection("ai");
    setActiveView("settings");
  };

  const handleWindowAction = async (action) => {
    const nativeAction = window.desktop?.window?.[action];
    if (nativeAction) {
      try {
        const result = await nativeAction();
        if (action === "toggleMaximize") setIsMaximized(Boolean(result));
        return;
      } catch {
        setWindowNotice("原生窗口操作暂时不可用");
      }
    } else {
      setWindowNotice(action === "minimize" ? "桌面版将在这里最小化窗口" : action === "toggleMaximize" ? "最大化与还原仅在桌面版中可用" : "浏览器原型不会关闭；桌面版将连接系统关闭按钮");
    }
    window.setTimeout(() => setWindowNotice(""), 2500);
  };

  return { activeView, setActiveView, settingsSection, setSettingsSection, dialogMethod, setDialogMethod, demoDialogOpen, setDemoDialogOpen, archiveData, aiConfig, setAiConfig, accountState, accountBusy, archiveRepairing, isMaximized, windowNotice, refreshAccounts, handleRepairArchive, handleSwitchAccount, handleAddAccount, handleDeleteAccount, start, complete, completeDemoImport, openAiSettings, handleWindowAction };
}

export { useAppController };
