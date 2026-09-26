import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle, HardDrive, UploadSimple, X } from "@phosphor-icons/react";
import { useDialogFocus } from "../../hooks/useDialogFocus.js";
import { demoArchive, getDemoStats } from "../../mockArchive.js";

function DemoImportDialog({ onClose, onComplete }) {
  const [stage, setStage] = useState("ready");
  const [progress, setProgress] = useState(0);
  const stats = getDemoStats(demoArchive);
  const dialogRef = useDialogFocus({ canClose: stage !== "importing", onClose });

  useEffect(() => {
    if (stage !== "importing") return undefined;
    const timer = window.setInterval(() => {
      setProgress((value) => {
        const next = Math.min(value + 10, 100);
        if (next === 100) {
          window.clearInterval(timer);
          window.setTimeout(() => setStage("success"), 220);
        }
        return next;
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [stage]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && stage !== "importing" && onClose()}>
      <section ref={dialogRef} tabIndex={-1} className="backup-dialog demo-import-dialog" role="dialog" aria-modal="true" aria-labelledby="demo-dialog-title">
        {stage !== "importing" && (
          <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭"><X size={22} /></button>
        )}

        {stage === "ready" && (
          <>
            <div className="dialog-icon"><UploadSimple size={30} /></div>
            <p className="dialog-kicker">内置演示档案</p>
            <h2 id="demo-dialog-title">载入一份可完整浏览的数据</h2>
            <p className="dialog-copy">内容、昵称和互动均为虚构，用于测试档案浏览与 AI 回顾，不会访问网络或读取真实账号。</p>
            <div className="demo-manifest">
              <div><strong>{stats.total}</strong><span>条内容</span></div>
              <div><strong>{stats.comments}</strong><span>条评论</span></div>
              <div><strong>{stats.likes}</strong><span>次点赞</span></div>
              <div><strong>7</strong><span>个年份</span></div>
            </div>
            <div className="trust-row"><HardDrive size={18} /><span>演示档案只保存在当前应用的本地存储中。</span></div>
            <button className="dialog-primary" type="button" onClick={() => setStage("importing")}>
              开始载入<ArrowRight size={20} />
            </button>
          </>
        )}

        {stage === "importing" && (
          <div className="center-state progress-state">
            <div className="progress-number">{progress}%</div>
            <h2 id="demo-dialog-title">正在建立演示档案</h2>
            <p>{progress < 40 ? "正在读取说说与日志…" : progress < 75 ? "正在整理相册与互动…" : "正在生成回顾索引…"}</p>
            <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
            <small>所有内容均为内置虚构数据</small>
          </div>
        )}

        {stage === "success" && (
          <div className="center-state success-state">
            <CheckCircle size={54} weight="fill" />
            <p className="dialog-kicker">载入完成</p>
            <h2 id="demo-dialog-title">演示档案已经准备好</h2>
            <p>你现在可以搜索时间线、筛选内容、查看评论点赞，并打开 AI 回顾。</p>
            <button className="dialog-primary" type="button" onClick={onComplete}>打开我的档案<ArrowRight size={20} /></button>
          </div>
        )}
      </section>
    </div>
  );
}

export { DemoImportDialog };
