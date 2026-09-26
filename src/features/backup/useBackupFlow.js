import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "../../hooks/useDialogFocus.js";
import { readableError } from "../../lib/presentation.js";
import { demoArchive, getDemoStats } from "../../mockArchive.js";
import { backupOptions } from "./options.js";

function useBackupFlow({ onClose, onComplete, onAccountChange }) {
  const [step, setStep] = useState("connect");
  const [selected, setSelected] = useState(() => backupOptions.map((item) => item.id));
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("正在准备本地归档…");
  const [flowError, setFlowError] = useState("");
  const [collectionResult, setCollectionResult] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [openingArchive, setOpeningArchive] = useState(false);
  const [forceReauthenticate, setForceReauthenticate] = useState(false);
  const [backupDirectory, setBackupDirectory] = useState("文档/空间备份");
  const activeJobIdRef = useRef("");
  const nativeCollectorAvailable = Boolean(window.desktop?.qzone?.startCollection);
  const dialogRef = useDialogFocus({ canClose: step !== "progress", onClose });

  useEffect(() => {
    if (!window.desktop?.qzone?.onCollectorEvent) return undefined;
    return window.desktop.qzone.onCollectorEvent((event) => {
      if (!event?.jobId) return;
      if (!activeJobIdRef.current) activeJobIdRef.current = event.jobId;
      if (event.jobId !== activeJobIdRef.current) return;
      if (event.type === "progress") {
        setProgress(event.progress);
        setProgressMessage(event.message || "正在整理本地归档…");
        return;
      }
      if (event.type === "complete") {
        activeJobIdRef.current = "";
        setProgress(100);
        setCollectionResult(event);
        setStep("success");
        void onAccountChange?.();
        return;
      }
      if (event.type === "cancelled") {
        activeJobIdRef.current = "";
        setCancelling(false);
        setFlowError(event.message || "采集任务已取消，恢复点已经保留");
        setStep("choose");
        void onAccountChange?.();
        return;
      }
      if (event.type === "error") {
        activeJobIdRef.current = "";
        setCancelling(false);
        if (event.phase === "authentication_required") {
          setForceReauthenticate(true);
          const saved = event.counts?.entries || 0;
          setFlowError(saved > 0
            ? `QQ 拒绝了后续请求或会话需要刷新。本地档案现有 ${saved} 条内容，已登记到“我的档案”；重新扫码后可以从恢复点继续。`
            : "QQ 会话需要刷新，目前还没有取得可归档内容；请重新扫码后再试。");
          setStep("connect");
        } else {
          setFlowError(event.message || "采集进程未能完成，请稍后重试");
          setStep("choose");
        }
        void onAccountChange?.();
      }
    });
  }, []);

  useEffect(() => {
    window.desktop?.dialogs?.getBackupDirectory?.().then(setBackupDirectory).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (step !== "progress" || nativeCollectorAvailable) return undefined;
    const timer = window.setInterval(() => {
      setProgress((value) => {
        const next = Math.min(value + 8, 100);
        if (next === 100) {
          window.clearInterval(timer);
          window.setTimeout(() => setStep("success"), 350);
        }
        return next;
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [nativeCollectorAvailable, step]);

  const demoTotal = getDemoStats(demoArchive).total;

  const connect = async () => {
    setFlowError("");
    setStep("connecting");
    if (!window.desktop?.qzone?.openLogin) {
      window.setTimeout(() => setStep("choose"), 900);
      return;
    }
    try {
      const status = await window.desktop.qzone.openLogin({ force: forceReauthenticate });
      if (!status?.authenticated) {
        setFlowError("登录窗口已关闭，尚未取得可用的 QQ 空间会话。");
        setStep("connect");
        return;
      }
      setForceReauthenticate(false);
      await onAccountChange?.();
      setStep("choose");
    } catch (error) {
      setFlowError(readableError(error));
      setStep("connect");
    }
  };

  const beginCollection = async () => {
    setFlowError("");
    setProgress(0);
    setProgressMessage("正在启动独立采集进程…");
    setStep("progress");
    if (!nativeCollectorAvailable) return;
    try {
      const result = await window.desktop.qzone.startCollection({ items: selected });
      activeJobIdRef.current = result.jobId;
    } catch (error) {
      const message = readableError(error);
      if (/QQ.*(?:登录|会话)|重新扫码/.test(message)) {
        setForceReauthenticate(true);
        setFlowError("QQ 空间会话尚未完整建立，请重新扫码并等待登录窗口自动关闭。");
        setStep("connect");
      } else {
        setFlowError(message);
        setStep("choose");
      }
    }
  };

  const cancelCollection = async () => {
    if (!activeJobIdRef.current || cancelling) return;
    setCancelling(true);
    try {
      await window.desktop?.qzone?.cancelCollection?.(activeJobIdRef.current);
      setProgressMessage("正在安全停止，并保存恢复点…");
    } catch (error) {
      setCancelling(false);
      setFlowError(readableError(error));
    }
  };

  const openCollectedArchive = async () => {
    if (!collectionResult || openingArchive) return;
    setOpeningArchive(true);
    setFlowError("");
    try {
      const archive = await window.desktop?.qzone?.readArchive?.();
      if (!archive) throw new Error("本地档案已经写入，但暂时无法读取索引");
      onComplete(archive);
    } catch (error) {
      setFlowError(readableError(error));
      setOpeningArchive(false);
    }
  };

  const toggle = (id) => {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  };

  return { forceReauthenticate, activeJobIdRef, step, selected, progress, progressMessage, flowError, collectionResult, cancelling, openingArchive, backupDirectory, nativeCollectorAvailable, dialogRef, demoTotal, connect, beginCollection, cancelCollection, openCollectedArchive, toggle };
}

export { useBackupFlow };
