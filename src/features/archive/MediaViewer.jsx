import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, CaretLeft, CaretRight, Images, Minus, Plus, X, CornersIn } from "@phosphor-icons/react";
import { useDialogFocus } from "../../hooks/useDialogFocus.js";
import { MediaThumbnail } from "./MediaGrid.jsx";

function ArchivedVideo({ video, index }) {
  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const videoRef = useRef(null);
  const playable = Boolean(video.src) && !failed;
  const poster = posterFailed ? "" : video.poster;
  useEffect(() => {
    const player = videoRef.current;
    return () => { player?.pause(); };
  }, []);
  return (
    <figure className={`viewer-video ${playable ? "is-playable" : "is-poster-only"}`}>
      {playable ? (
        <video ref={videoRef} controls autoPlay preload="metadata" playsInline poster={poster || undefined}
          aria-label={`播放第 ${index + 1} 项视频`} onError={() => setFailed(true)}>
          <source src={video.src} type={video.contentType || "video/mp4"} onError={() => setFailed(true)} />
        </video>
      ) : <>
        {poster ? <div className="video-poster"><img src={poster} alt="已保存的视频封面" draggable={false} onError={() => setPosterFailed(true)} /></div>
          : <div className="video-placeholder"><Images size={30} weight="duotone" /><span>暂无可用的视频封面</span></div>}
        <figcaption className="video-status" role="status">
          <strong>{failed ? "当前视频无法播放" : poster ? "仅保留视频封面" : "视频未能下载"}</strong>
          <span>{failed ? "本地文件可能损坏或编码不受支持。可在设置中检查档案后重新备份。" : "未保存可播放的原视频，可稍后重新备份补充。"}</span>
        </figcaption>
      </>}
    </figure>
  );
}

function MediaViewer({ media, index, onChange, onClose }) {
  const item = media[index];
  const isVideo = item.kind === "video";
  const hasVideo = media.some((entry) => entry.kind === "video");
  const dialogRef = useDialogFocus({ canClose: false });
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const [transform, setTransform] = useState(transformRef.current);
  const [dragging, setDragging] = useState(false);

  const applyTransform = (candidate) => {
    const stage = stageRef.current;
    const nextScale = Math.min(5, Math.max(1, candidate.scale));
    if (!stage || nextScale === 1) {
      const reset = { scale: 1, x: 0, y: 0 };
      transformRef.current = reset;
      setTransform(reset);
      return;
    }
    const image = imageRef.current;
    const stageRect = stage.getBoundingClientRect();
    const naturalWidth = image?.naturalWidth || stageRect.width;
    const naturalHeight = image?.naturalHeight || stageRect.height;
    const fitScale = Math.min(stageRect.width / naturalWidth, stageRect.height / naturalHeight);
    const fittedWidth = naturalWidth * fitScale;
    const fittedHeight = naturalHeight * fitScale;
    const maxX = Math.max(0, (fittedWidth * nextScale - stageRect.width) / 2);
    const maxY = Math.max(0, (fittedHeight * nextScale - stageRect.height) / 2);
    const next = {
      scale: nextScale,
      x: Math.min(maxX, Math.max(-maxX, candidate.x)),
      y: Math.min(maxY, Math.max(-maxY, candidate.y)),
    };
    transformRef.current = next;
    setTransform(next);
  };

  const resetView = () => applyTransform({ scale: 1, x: 0, y: 0 });

  const zoomAt = (nextScale, clientX, clientY) => {
    const current = transformRef.current;
    const stageRect = stageRef.current?.getBoundingClientRect();
    const boundedScale = Math.min(5, Math.max(1, nextScale));
    if (!stageRect || boundedScale === 1) {
      resetView();
      return;
    }
    const anchorX = Number.isFinite(clientX) ? clientX - stageRect.left - stageRect.width / 2 : 0;
    const anchorY = Number.isFinite(clientY) ? clientY - stageRect.top - stageRect.height / 2 : 0;
    const ratio = boundedScale / current.scale;
    applyTransform({
      scale: boundedScale,
      x: anchorX - (anchorX - current.x) * ratio,
      y: anchorY - (anchorY - current.y) * ratio,
    });
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !document.fullscreenElement) onClose();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") event.preventDefault();
      if (event.key === "ArrowLeft") onChange((index - 1 + media.length) % media.length);
      if (event.key === "ArrowRight") onChange((index + 1) % media.length);
      if (event.key === "0" && !isVideo) resetView();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [media.length, index, onChange, onClose, isVideo]);

  useEffect(() => {
    const reset = { scale: 1, x: 0, y: 0 };
    transformRef.current = reset;
    setTransform(reset);
    setDragging(false);
    dragRef.current = null;
    dialogRef.current?.querySelector(".image-viewer-thumbnails .active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const observer = new ResizeObserver(() => applyTransform(transformRef.current));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const handleWheel = (event) => {
    if (isVideo) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.16 : 1 / 1.16;
    zoomAt(transformRef.current.scale * factor, event.clientX, event.clientY);
  };

  const handlePointerDown = (event) => {
    if (isVideo || event.button !== 0 || transformRef.current.scale <= 1) return;
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Synthetic test pointers have no native capture target. */ }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    applyTransform({
      scale: transformRef.current.scale,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const endDrag = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* Pointer capture may already be released. */ }
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div ref={dialogRef} tabIndex={-1} className={`image-viewer ${media.length === 1 ? "single-image" : ""}`} role="dialog" aria-modal="true" aria-label={hasVideo ? "照片与视频查看器" : "图片查看器"} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="image-viewer-toolbar">
        <div className="image-viewer-meta"><span>{index + 1} / {media.length}</span><small>{isVideo ? "视频 · 左右切换照片与视频" : "滚轮缩放 · 放大后拖动"}</small></div>
        {!isVideo ? <div className="viewer-zoom-controls" aria-label="图片缩放控制">
          <button type="button" onClick={() => zoomAt(transform.scale / 1.2)} disabled={transform.scale <= 1} aria-label="缩小图片"><Minus size={17} /></button>
          <output aria-live="polite">{Math.round(transform.scale * 100)}%</output>
          <button type="button" onClick={() => zoomAt(transform.scale * 1.2)} disabled={transform.scale >= 5} aria-label="放大图片"><Plus size={17} /></button>
          <button type="button" onClick={resetView} disabled={transform.scale === 1} aria-label="适应窗口" title="适应窗口（双击图片或按 0）"><CornersIn size={17} /></button>
        </div> : <span />}
        <button className="viewer-close" type="button" onClick={onClose} aria-label={hasVideo ? "关闭媒体查看器" : "关闭图片查看器"}><X size={24} /></button>
      </div>
      <div className="image-viewer-stage">
        {media.length > 1 && <button className="viewer-nav previous" type="button" onClick={() => onChange((index - 1 + media.length) % media.length)} aria-label={hasVideo ? "上一项" : "上一张"}><CaretLeft size={30} /></button>}
        <div
          ref={stageRef}
          className={`image-viewer-image-stage ${isVideo ? "is-video" : ""} ${dragging ? "is-dragging" : ""} ${transform.scale > 1 ? "is-zoomed" : ""}`}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={isVideo ? undefined : resetView}
          title={isVideo ? undefined : "滚轮缩放，放大后拖动，双击恢复适应窗口"}
        >
          {isVideo ? <ArchivedVideo key={`${index}:${item.src}:${item.poster}`} video={item} index={index} /> : <img
            ref={imageRef}
            src={item.src}
            alt={`第 ${index + 1} 张大图`}
            draggable={false}
            data-zoom={transform.scale.toFixed(3)}
            data-offset-x={transform.x.toFixed(2)}
            data-offset-y={transform.y.toFixed(2)}
            onLoad={() => applyTransform(transformRef.current)}
            style={{ transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})` }}
          />}
        </div>
        {media.length > 1 && <button className="viewer-nav next" type="button" onClick={() => onChange((index + 1) % media.length)} aria-label={hasVideo ? "下一项" : "下一张"}><CaretRight size={30} /></button>}
      </div>
      {media.length > 1 && (
        <div className="image-viewer-thumbnails" aria-label={hasVideo ? "照片与视频缩略图" : "图片缩略图"}>
          {media.map((thumbnail, thumbnailIndex) => (
            <button className={thumbnailIndex === index ? "active" : ""} type="button" key={`${thumbnail.src}:${thumbnail.poster}-viewer-${thumbnailIndex}`} onClick={() => onChange(thumbnailIndex)} aria-label={`转到第 ${thumbnailIndex + 1} ${hasVideo ? (thumbnail.kind === "video" ? "项视频" : "项图片") : "张"}`} aria-current={thumbnailIndex === index ? "true" : undefined}>
              <MediaThumbnail item={thumbnail} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { MediaViewer };
