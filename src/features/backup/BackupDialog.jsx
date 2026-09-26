import { ArrowRight, Check, CheckCircle, HardDrive, Info, ShieldCheck, WarningCircle, X } from "@phosphor-icons/react";
import { LoadingSpinner } from "../../components/LoadingSpinner.jsx";
import { formatFileSize } from "../../lib/presentation.js";
import { backupOptions } from "./options.js";
import { useBackupFlow } from "./useBackupFlow.js";

function BackupDialog({ onClose, onComplete, onAccountChange }) {
  const { forceReauthenticate, activeJobIdRef, step, selected, progress, progressMessage, flowError, collectionResult, cancelling, openingArchive, backupDirectory, nativeCollectorAvailable, dialogRef, demoTotal, connect, beginCollection, cancelCollection, openCollectedArchive, toggle } = useBackupFlow({ onClose, onComplete, onAccountChange });
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && step !== "progress" && onClose()}>
      <section ref={dialogRef} tabIndex={-1} className="backup-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        {step !== "progress" && step !== "success" && (
          <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭"><X size={22} /></button>
        )}

        {step === "connect" && (
          <>
            <div className="dialog-icon"><ShieldCheck size={30} /></div>
            <p className="dialog-kicker">应用内安全登录</p>
            <h2 id="dialog-title">准备连接你的 QQ 空间</h2>
            <p className="dialog-copy">
              {nativeCollectorAvailable
                ? "应用将打开 QQ 官方登录页面。会话只在本次连接与备份期间临时使用，任务结束后自动清除；应用不会读取你的密码。"
                : "浏览器预览不会连接真实账号；请在桌面版中使用 QQ 官方登录页面。"}
            </p>
            <div className="trust-row"><Info size={18} weight="fill" /><span>{nativeCollectorAvailable ? "Cookie 不会发送到界面，也不会写入本地归档。" : "当前流程仅用于界面演示，不会读取真实账号。"}</span></div>
            {flowError && <p className="dialog-error" role="alert"><WarningCircle size={17} weight="fill" />{flowError}</p>}
            <button className="dialog-primary" type="button" onClick={connect}>
              {forceReauthenticate ? "重新扫码登录" : "打开扫码登录"}<ArrowRight size={20} />
            </button>
          </>
        )}

        {step === "connecting" && (
          <div className="center-state">
            <LoadingSpinner size={42} />
            <h2 id="dialog-title">正在建立本地连接</h2>
            <p>确认登录状态与访问权限，请稍候。</p>
          </div>
        )}

        {step === "choose" && (
          <>
            <p className="dialog-kicker">选择备份内容</p>
            <h2 id="dialog-title">这次想带回哪些记忆？</h2>
            <div className="option-list">
              {backupOptions.map((item) => {
                const Icon = item.icon;
                const checked = selected.includes(item.id);
                return (
                  <button className={`backup-option ${checked ? "selected" : ""}`} type="button" key={item.id} onClick={() => toggle(item.id)}>
                    <span className="option-icon"><Icon size={22} /></span>
                    <span><strong>{item.label}</strong><small>{item.description}</small></span>
                    <span className="check-box">{checked && <Check size={15} weight="bold" />}</span>
                  </button>
                );
              })}
            </div>
            <div className="estimate"><HardDrive size={18} /><span>备份前不预估容量，完成后按实际下载量显示；保存到“{backupDirectory}”</span></div>
            {flowError && <p className="dialog-error" role="alert"><WarningCircle size={17} weight="fill" />{flowError}</p>}
            <button className="dialog-primary" type="button" disabled={!selected.length} onClick={beginCollection}>
              开始创建本地档案<ArrowRight size={20} />
            </button>
          </>
        )}

        {step === "progress" && (
          <div className="center-state progress-state">
            <div className="progress-number">{progress}%</div>
            <h2 id="dialog-title">{nativeCollectorAvailable ? "正在准备你的空间档案" : "正在整理你的空间"}</h2>
            <p>{nativeCollectorAvailable ? progressMessage : progress < 45 ? "正在读取说说与日志…" : progress < 78 ? "正在整理相册与互动…" : "正在生成本地索引…"}</p>
            <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
            <small>可以稍后继续，已完成的内容不会重复处理</small>
            {nativeCollectorAvailable && <button className="dialog-cancel" type="button" disabled={cancelling || !activeJobIdRef.current} onClick={cancelCollection}>{cancelling ? "正在停止…" : "取消本次任务"}</button>}
          </div>
        )}

        {step === "success" && (
          <div className="center-state success-state">
            <CheckCircle size={54} weight="fill" />
            <p className="dialog-kicker">{collectionResult ? "本地备份完成" : "第一次备份完成"}</p>
            <h2 id="dialog-title">{collectionResult ? `${collectionResult.counts?.entries || 0} 条内容已归档` : `${demoTotal} 条记忆已安全回家`}</h2>
            {collectionResult
              ? <>{collectionResult.truncated && <p className="dialog-warning"><WarningCircle size={17} weight="fill" />{collectionResult.partialReason === "likes" ? "说说正文已经保存；QQ 暂未继续返回点赞名单，稍后再次备份会从已保存状态继续补充。" : "QQ 本次只返回了部分时间线，当前可读取内容已经保存；稍后再次备份仍会继续尝试更早内容。"}</p>}{collectionResult.adapterHealth?.status === "degraded" && <p className="dialog-warning"><WarningCircle size={17} weight="fill" />{collectionResult.adapterHealth.message}</p>}<p>本次新增 {collectionResult.changes?.added || 0} 条、更新 {collectionResult.changes?.updated || 0} 条、跳过 {collectionResult.changes?.skipped || 0} 条未变化内容；共保存 {collectionResult.counts?.media || 0} 张图片（{formatFileSize(collectionResult.counts?.mediaBytes)}）。QQ 报告 {collectionResult.counts?.comments || 0} 条评论、{collectionResult.counts?.likes || 0} 次点赞，其中已展开保存 {collectionResult.counts?.visibleComments || 0} 条评论和 {collectionResult.counts?.visibleLikes || 0} 位点赞者。QQ 临时会话已自动清除。</p><code className="archive-path">{collectionResult.archivePath}</code>{flowError && <p className="dialog-error" role="alert"><WarningCircle size={17} weight="fill" />{flowError}</p>}</>
              : <p>当前是演示数据。正式采集接入后，档案会保存在你选择的本地目录。</p>}
            <button className="dialog-primary" type="button" disabled={openingArchive} onClick={collectionResult ? openCollectedArchive : onComplete}>{openingArchive ? <><LoadingSpinner />正在读取档案…</> : <>{collectionResult ? "打开我的档案" : "查看我的档案"}<ArrowRight size={20} /></>}</button>
          </div>
        )}
      </section>
    </div>
  );
}

export { BackupDialog };
