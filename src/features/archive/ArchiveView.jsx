import { useLayoutEffect, useRef, useState } from "react";
import { Archive, ChatsCircle, FileArrowDown, Heart, LinkSimple, MagnifyingGlass, MapPin, WarningCircle } from "@phosphor-icons/react";
import { EmptyView } from "../../components/EmptyView.jsx";
import { archiveMedia } from "../../domain/media.js";
import { safeExternalUrl } from "../../lib/presentation.js";
import { getDemoStats } from "../../mockArchive.js";
import { ArchiveExportDialog } from "./ArchiveExportDialog.jsx";
import { ArchiveText } from "./ArchiveText.jsx";
import { MediaGrid } from "./MediaGrid.jsx";
import { MediaViewer } from "./MediaViewer.jsx";
import { VirtualTimeline } from "./VirtualTimeline.jsx";
import { archiveFilters, entryTypeMeta } from "./options.js";
import { useArchiveEntries } from "./useArchiveEntries.js";

function ArchiveView({ archive, onStart, onImportDemo, onReadPage }) {
  const { filter, setFilter, query, setQuery, selectedId, setSelectedId, entries, page, pageLoading, pageError, visibleEntries, selectedEntry, loadMoreEntries } = useArchiveEntries({ archive, onReadPage });
  const [viewer, setViewer] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const detailRef = useRef(null);
  const selectedMedia = archiveMedia(selectedEntry);
  const selectedLinks = (selectedEntry?.links || [])
    .map((link) => ({ link, url: safeExternalUrl(link.url) }))
    .filter((item) => item.url);

  useLayoutEffect(() => {
    const detail = detailRef.current;
    if (!detail) return undefined;
    const scrollRoot = detail.closest(".utility-view");
    let frame = 0;
    const applyDetailViewport = () => {
      const bottomGap = 12;
      const availableHeight = Math.max(96, Math.floor(window.innerHeight - detail.getBoundingClientRect().top - bottomGap));
      detail.style.setProperty("--archive-detail-max-height", availableHeight + "px");
      detail.classList.toggle("is-scrollable", detail.scrollHeight > detail.clientHeight);
    };
    const updateDetailViewport = () => {
      applyDetailViewport();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(applyDetailViewport);
    };
    const resizeObserver = new ResizeObserver(updateDetailViewport);
    const mutationObserver = new MutationObserver(updateDetailViewport);
    resizeObserver.observe(detail);
    mutationObserver.observe(detail, { childList: true, subtree: true, characterData: true });
    scrollRoot?.addEventListener("scroll", updateDetailViewport, { passive: true });
    window.addEventListener("resize", updateDetailViewport);
    detail.addEventListener("load", updateDetailViewport, true);
    updateDetailViewport();
    let settleAttempts = 0;
    const settleTimer = window.setInterval(() => {
      updateDetailViewport();
      settleAttempts += 1;
      if (settleAttempts >= 20) window.clearInterval(settleTimer);
    }, 100);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(settleTimer);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      scrollRoot?.removeEventListener("scroll", updateDetailViewport);
      window.removeEventListener("resize", updateDetailViewport);
      detail.removeEventListener("load", updateDetailViewport, true);
    };
  }, [archive?.id, selectedEntry?.id]);

  if (!archive) {
    return (
      <EmptyView
        icon={Archive}
        eyebrow="个人档案"
        title="我的档案"
        description="按时间线浏览已备份的说说、配图、视频与互动。"
        action="载入演示档案"
        onAction={onImportDemo}
        secondaryAction="创建第一份备份"
        onSecondaryAction={onStart}
        note="演示档案包含虚构内容，不会读取你的 QQ 空间。"
      />
    );
  }

  const stats = getDemoStats(archive);
  return (
    <section className="utility-view archive-view">
      <div className="archive-heading-row">
        <div className="utility-heading">
          <span>个人档案</span>
          <h1>我的档案</h1>
          <p>{archive.profileName}</p>
        </div>
        <div className="archive-heading-actions">
          {archive.isDemo && <span className="demo-badge">演示数据</span>}
          {!archive.isDemo && <button className="outline-action" type="button" onClick={() => setExportOpen(true)}><FileArrowDown size={16} />导出档案</button>}
          <button className="outline-action" type="button" onClick={archive.isDemo ? onImportDemo : onStart}>{archive.isDemo ? "重新载入" : "再次备份"}</button>
        </div>
      </div>

      {archive.integrity?.needsRepair && (
        <div className="integrity-banner" role="alert">
          <WarningCircle size={19} weight="fill" />
          <span>发现 {archive.integrity.corruptEntries?.length || 0} 条损坏记录和 {(archive.integrity.missingMedia?.length || 0) + (archive.integrity.unsafeMedia?.length || 0)} 个媒体文件问题。修复前不会删除原始问题记录。</span>
        </div>
      )}

      <div className="archive-overview" aria-label="档案统计">
        <div><strong>{stats.total}</strong><span>条内容</span></div>
        <div><strong>{stats.post}</strong><span>说说</span></div>
        <div><strong>{stats.journal}</strong><span>日志</span></div>
        <div><strong>{stats.album}</strong><span>相册</span></div>
        <div><strong>{stats.comments}</strong><span>评论总数</span></div>
        <div><strong>{stats.likes}</strong><span>点赞总数</span></div>
      </div>
      {(stats.visibleComments < stats.comments || stats.visibleLikes < stats.likes) && <p className="archive-stats-note">互动总数来自 QQ；评论内容和点赞者仅显示本次接口返回的可见详情。</p>}

      <div className="archive-tools">
        <label className="archive-search">
          <MagnifyingGlass size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文字或地点" />
        </label>
        <div className="archive-filters" aria-label="内容类型">
          {archiveFilters.map((item) => (
            <button
              className={filter === item.id ? "active" : ""}
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="archive-workspace">
        <VirtualTimeline
          entries={visibleEntries}
          selectedId={selectedEntry?.id || ""}
          onSelect={setSelectedId}
          hasMore={Boolean(!archive.isDemo && page?.hasMore)}
          loading={pageLoading}
          onLoadMore={loadMoreEntries}
        />

        <aside className="archive-detail" aria-live="polite" ref={detailRef}>
          {selectedEntry ? (
            <>
              <div className="detail-heading">
                <span>{entryTypeMeta[selectedEntry.type]?.label || "内容"}</span>
                <small>{selectedEntry.displayDate}</small>
                {selectedEntry.title && <h2>{selectedEntry.title}</h2>}
              </div>
              <p className={`detail-body ${selectedEntry.title ? "" : "titleless"}`}><ArchiveText text={selectedEntry.text} /></p>
              {selectedLinks.length > 0 && (
                <div className="detail-links" aria-label="动态中的外部链接">
                  {selectedLinks.map(({ link, url }, index) => (
                    <a key={`${url.href}-${index}`} href={url.href} target="_blank" rel="noreferrer">
                      <LinkSimple size={15} /><span>{link.label || "外部链接"}</span><small>{url.hostname}</small>
                    </a>
                  ))}
                </div>
              )}
              <MediaGrid key={selectedEntry.id} media={selectedMedia} onOpen={(index) => setViewer({ media: selectedMedia, index })} />
              {selectedEntry.location && <p className="detail-location"><MapPin size={16} />{selectedEntry.location}</p>}
              <div className="detail-section">
                <strong><Heart size={17} />{Math.max(selectedEntry.likes.length, Number(selectedEntry.likeCount) || 0)} 人点赞</strong>
                {selectedEntry.likes.length ? (
                  <p className="detail-like-list">{selectedEntry.likes.map((name, index) => (
                    <span key={`${selectedEntry.id}-like-${index}`}><ArchiveText text={name} />{index < selectedEntry.likes.length - 1 ? "、" : ""}</span>
                  ))}</p>
                ) : <p className="detail-empty-interaction">QQ 本次没有返回可见的点赞者名单。</p>}
                {Number(selectedEntry.likeCount) > selectedEntry.likes.length && <small className="detail-expansion-note">已保存 {selectedEntry.likes.length} 位当前可见点赞者，名单可能不完整。</small>}
              </div>
              <div className="detail-section">
                <strong><ChatsCircle size={17} />评论 {Math.max(selectedEntry.comments.length, Number(selectedEntry.commentCount) || 0)}</strong>
                {selectedEntry.comments.length ? selectedEntry.comments.map((comment, index) => (
                  <p className="detail-comment" key={`${selectedEntry.id}-${index}`}><b title={comment.authorName || comment.name || "QQ 用户"}><ArchiveText text={comment.authorName || comment.name || "QQ 用户"} /></b><span className="detail-comment-separator">：</span><span className="detail-comment-text"><ArchiveText text={comment.text} /></span></p>
                )) : <p>这条内容还没有评论。</p>}
                {Number(selectedEntry.commentCount) > selectedEntry.comments.length && <small className="detail-expansion-note">已保存 {selectedEntry.comments.length} 条当前可见评论，详情可能不完整。</small>}
              </div>
            </>
          ) : <p className="detail-placeholder">从左侧选择一条内容查看详情。</p>}
        </aside>
      </div>
      {pageError && <div className="timeline-error" role="alert"><WarningCircle size={15} />{pageError}</div>}
      {viewer && (
        <MediaViewer
          media={viewer.media}
          index={viewer.index}
          onChange={(nextIndex) => setViewer((current) => ({ ...current, index: nextIndex }))}
          onClose={() => setViewer(null)}
        />
      )}
      {exportOpen && <ArchiveExportDialog filter={filter} query={query} onClose={() => setExportOpen(false)} />}
    </section>
  );
}

export { ArchiveView };
