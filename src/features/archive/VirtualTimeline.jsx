import { archiveMedia } from "../../domain/media.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChatsCircle, Heart, Images, MagnifyingGlass, NotePencil, PlayCircle } from "@phosphor-icons/react";
import { ArchiveText } from "./ArchiveText.jsx";
import { entryTypeMeta } from "./options.js";

const TIMELINE_ROW_HEIGHT = 112;

function VirtualTimeline({ entries, selectedId, onSelect, hasMore, loading, onLoadMore }) {
  const listRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(420);
  const loadStateRef = useRef({ hasMore, loading, onLoadMore });
  const loadRequestedRef = useRef(false);
  loadStateRef.current = { hasMore, loading, onLoadMore };
  const overscan = 5;
  const startIndex = Math.max(0, Math.floor(scrollTop / TIMELINE_ROW_HEIGHT) - overscan);
  const visibleCount = Math.ceil(viewportHeight / TIMELINE_ROW_HEIGHT) + overscan * 2;
  const endIndex = Math.min(entries.length, startIndex + visibleCount);

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = list?.closest(".utility-view");
    if (!list || !scroller) return undefined;
    const update = () => {
      const listRect = list.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      setScrollTop(Math.max(0, scrollerRect.top - listRect.top));
      setViewportHeight(scroller.clientHeight || 420);
      const state = loadStateRef.current;
      const nearListEnd = listRect.bottom <= scrollerRect.bottom + TIMELINE_ROW_HEIGHT * 3;
      if (nearListEnd && state.hasMore && !state.loading && !loadRequestedRef.current) {
        loadRequestedRef.current = true;
        Promise.resolve(state.onLoadMore?.()).finally(() => {
          loadRequestedRef.current = false;
        });
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(list);
    observer.observe(scroller);
    scroller.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", update);
    };
  }, [entries.length, hasMore, loading]);

  useEffect(() => {
    if (!entries.some((entry) => entry.id === selectedId)) {
      listRef.current?.closest('.utility-view')?.scrollTo({ top: 0 });
    }
  }, [entries, selectedId]);

  if (!entries.length) {
    return (
      <div className="timeline-list is-empty">
        <div className="archive-no-results">
          <MagnifyingGlass size={28} />
          <strong>{loading ? "正在读取档案…" : "没有找到相关内容"}</strong>
          <span>{loading ? "只会读取当前页，不会一次载入全部记录。" : "换一个关键词或内容类型试试。"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-list is-virtual" aria-label="档案时间线" ref={listRef}>
      <div className="timeline-virtual-space" style={{ height: entries.length * TIMELINE_ROW_HEIGHT + (hasMore ? 38 : 0) }}>
        {entries.slice(startIndex, endIndex).map((entry, index) => {
          const media = archiveMedia(entry);
          const imageCount = media.filter((item) => item.kind === "image").length;
          const videoCount = media.filter((item) => item.kind === "video").length;
          const TypeIcon = entryTypeMeta[entry.type]?.icon || NotePencil;
          const isSelected = selectedId === entry.id;
          const absoluteIndex = startIndex + index;
          return (
            <button
              className={`timeline-entry ${isSelected ? "selected" : ""}`}
              style={{ top: absoluteIndex * TIMELINE_ROW_HEIGHT }}
              key={entry.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(entry.id)}
            >
              <span className="timeline-type"><TypeIcon size={18} /></span>
              <span className="timeline-entry-copy">
                <span className="timeline-date">{entry.displayDate}</span>
                {entry.title && <strong>{entry.title}</strong>}
                <span className={entry.title ? "timeline-excerpt" : "timeline-post-copy"}><ArchiveText text={entry.text || (videoCount ? "视频说说" : imageCount ? "图片说说" : "无文字内容")} /></span>
                <small>
                  {imageCount ? <><Images size={14} />{imageCount}</> : null}
                  {videoCount ? <><PlayCircle size={14} />{videoCount}</> : null}
                  <Heart size={14} />{Math.max(entry.likes.length, Number(entry.likeCount) || 0)}
                  <ChatsCircle size={14} />{Math.max(entry.comments.length, Number(entry.commentCount) || 0)}
                </small>
              </span>
            </button>
          );
        })}
        {hasMore && <div className="timeline-page-status" style={{ top: entries.length * TIMELINE_ROW_HEIGHT }}>{loading ? "正在读取更多…" : "继续向下滚动以读取更多"}</div>}
      </div>
    </div>
  );
}

export { VirtualTimeline };
