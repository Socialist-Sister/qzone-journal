import { useEffect, useState } from "react";
import { CheckCircle, FileArrowDown, WarningCircle, X } from "@phosphor-icons/react";
import { LoadingSpinner } from "../../components/LoadingSpinner.jsx";
import { useDialogFocus } from "../../hooks/useDialogFocus.js";
import { readableError } from "../../lib/presentation.js";
import { entryTypeMeta } from "./options.js";

const EXPORT_ANONYMIZE_KEY = "qzone-journal-export-anonymize";

function readExportAnonymizePreference() {
  try {
    return window.localStorage.getItem(EXPORT_ANONYMIZE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeExportAnonymizePreference(value) {
  try {
    window.localStorage.setItem(EXPORT_ANONYMIZE_KEY, value ? "true" : "false");
  } catch {
    // This preference is optional in restricted browser previews.
  }
}

function ArchiveExportDialog({ filter, query, onClose }) {
  const [format, setFormat] = useState("html");
  const [scope, setScope] = useState(query || filter !== "all" ? "filtered" : "all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [media, setMedia] = useState("compact");
  const [includeComments, setIncludeComments] = useState(true);
  const [includeLikes, setIncludeLikes] = useState(true);
  const [anonymize, setAnonymize] = useState(readExportAnonymizePreference);
  const [confirmedPeople, setConfirmedPeople] = useState(false);
  const [stage, setStage] = useState("options");
  const [progress, setProgress] = useState({ progress: 0, message: "正在准备导出…" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus({ canClose: stage !== "progress", onClose });

  useEffect(() => window.desktop?.qzone?.onExportEvent?.((payload) => {
    setProgress({ progress: Number(payload?.progress) || 0, message: payload?.message || "正在导出…" });
  }), []);

  const exposesPeople = !anonymize && (includeComments || includeLikes);
  const invalidDates = scope === "dates" && (!dateFrom || !dateTo || dateFrom > dateTo);
  const beginExport = async () => {
    if (!window.desktop?.qzone?.exportArchive) {
      setError("档案导出仅在桌面版中可用");
      return;
    }
    setStage("progress");
    setProgress({ progress: 3, message: "正在打开系统保存窗口…" });
    setError("");
    try {
      const exported = await window.desktop.qzone.exportArchive({
        format,
        scope,
        type: filter,
        query,
        dateFrom,
        dateTo,
        media,
        includeComments,
        includeLikes,
        anonymize,
        confirmedPeople,
      });
      if (!exported?.exported) {
        setStage("options");
        setProgress({ progress: 0, message: "正在准备导出…" });
        return;
      }
      setResult(exported);
      setStage("success");
    } catch (exportError) {
      setError(readableError(exportError));
      setStage("options");
    }
  };

  const setAnonymousPreference = (value) => {
    setAnonymize(value);
    setConfirmedPeople(false);
    writeExportAnonymizePreference(value);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && stage !== "progress" && onClose()}>
      <section ref={dialogRef} tabIndex={-1} className="backup-dialog export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
        {stage !== "progress" && <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭"><X size={22} /></button>}
        {stage === "options" && (
          <>
            <p className="dialog-kicker">导出本地档案</p>
            <h2 id="export-dialog-title">把这份档案带到哪里？</h2>
            <p className="dialog-copy">导出在本机完成，不会上传档案。当前版本支持说说正文、配图、视频封面与已保存的可见互动详情。</p>

            <div className="export-section">
              <strong>文件格式</strong>
              <div className="export-format-grid" role="radiogroup" aria-label="导出格式">
                {[
                  { id: "html", label: "HTML", note: "单文件，可离线浏览" },
                  { id: "pdf", label: "PDF", note: "固定排版，适合阅读" },
                  { id: "docx", label: "DOCX", note: "可在 Word/WPS 编辑" },
                ].map((item) => <button className={format === item.id ? "selected" : ""} key={item.id} type="button" role="radio" aria-checked={format === item.id} onClick={() => setFormat(item.id)}><b>{item.label}</b><span>{item.note}</span></button>)}
              </div>
            </div>

            <div className="export-section export-two-column">
              <label><strong>导出范围</strong><select value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">全部档案</option><option value="filtered">当前搜索与分类</option><option value="dates">指定日期范围</option></select></label>
              <label><strong>媒体封面</strong><select value={media} onChange={(event) => setMedia(event.target.value)}><option value="compact">压缩副本（推荐）</option><option value="original">原图与视频封面</option><option value="omit">不包含媒体</option></select></label>
            </div>
            {scope === "dates" && <div className="export-date-range"><label>开始日期<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><span>至</span><label>结束日期<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div>}
            {scope === "filtered" && <p className="export-scope-note">将导出“{filter === "all" ? "全部类型" : entryTypeMeta[filter]?.label || "当前类型"}”{query ? `中匹配“${query}”` : "中的当前结果"}。</p>}
            {media === "original" && <p className="export-scope-note">原图会显著增加导出时间和文件大小，较大的档案建议使用压缩副本。</p>}

            <div className="export-section export-check-list">
              <label><span><b>评论与回复</b><small>仅包含 QQ 当前返回并已保存在本地的正文</small></span><input type="checkbox" checked={includeComments} onChange={(event) => setIncludeComments(event.target.checked)} /></label>
              <label><span><b>点赞记录</b><small>名单可能少于 QQ 显示的点赞总数</small></span><input type="checkbox" checked={includeLikes} onChange={(event) => setIncludeLikes(event.target.checked)} /></label>
              <label><span><b>匿名化好友</b><small>替换互动昵称及正文中的好友提及，保留本人昵称</small></span><input type="checkbox" checked={anonymize} onChange={(event) => setAnonymousPreference(event.target.checked)} /></label>
            </div>

            {exposesPeople && <label className="export-privacy-confirm"><WarningCircle size={18} weight="fill" /><span><b>此文件会包含可见互动昵称</b><small>请仅在相关人员可接受的范围内保存和分享。</small></span><input type="checkbox" checked={confirmedPeople} onChange={(event) => setConfirmedPeople(event.target.checked)} /></label>}
            {error && <p className="dialog-error" role="alert"><WarningCircle size={17} weight="fill" />{error}</p>}
            <button className="dialog-primary" type="button" disabled={invalidDates || (exposesPeople && !confirmedPeople)} onClick={beginExport}><FileArrowDown size={19} />选择位置并导出</button>
          </>
        )}

        {stage === "progress" && (
          <div className="export-progress-state">
            <LoadingSpinner size={34} />
            <p className="dialog-kicker">正在生成 {format.toUpperCase()}</p>
            <h2 id="export-dialog-title">请稍候，窗口仍可正常响应</h2>
            <p>{progress.message}</p>
            <div className="export-progress-track" aria-label={`导出进度 ${progress.progress}%`}><span style={{ width: `${Math.max(4, progress.progress)}%` }} /></div>
            <small>{Math.round(progress.progress)}%</small>
          </div>
        )}

        {stage === "success" && (
          <div className="success-state export-success-state">
            <CheckCircle size={58} weight="fill" />
            <p className="dialog-kicker">导出完成</p>
            <h2 id="export-dialog-title">档案文件已经生成</h2>
            <p><b>{result?.fileName}</b><br />共导出 {result?.counts?.entries || 0} 条内容和 {result?.counts?.media || 0} 个媒体附件{result?.anonymized ? "，好友信息已匿名化" : ""}。</p>
            <button className="dialog-primary" type="button" onClick={onClose}>完成</button>
          </div>
        )}
      </section>
    </div>
  );
}

export { readExportAnonymizePreference, writeExportAnonymizePreference, ArchiveExportDialog };
