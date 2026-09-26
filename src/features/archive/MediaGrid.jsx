import { useState } from "react";
import { Images, Play } from "@phosphor-icons/react";
import { videoDurationLabel } from "../../domain/media.js";

function MediaThumbnail({ item }) {
  const [failed, setFailed] = useState(false);
  const src = item.kind === "video" ? item.poster : item.src;
  return <>
    {src && !failed ? <img src={src} alt="" draggable={false} loading="lazy" onError={() => setFailed(true)} />
      : <span className="media-placeholder"><Images size={24} /><span>{item.kind === "video" ? "视频" : "图片不可用"}</span></span>}
    {item.kind === "video" && <span className="media-play" aria-hidden="true"><Play size={20} weight="fill" /></span>}
  </>;
}

function MediaGrid({ media, onOpen }) {
  if (!media.length) return null;
  return (
    <div className={`media-grid media-count-${Math.min(media.length, 9)}`} aria-label={`共 ${media.length} 项照片与视频`}>
      {media.slice(0, 9).map((item, index) => (
        <button type="button" className={item.kind === "video" ? "media-video" : "media-image"}
          key={`${item.src}:${item.poster}:${index}`} onClick={() => onOpen(index)}
          aria-label={`查看第 ${index + 1} ${item.kind === "video" ? "项视频" : "张图片"}`}>
          <MediaThumbnail item={item} />
          {item.kind === "video" && videoDurationLabel(item.durationMs) && <span className="media-duration">{videoDurationLabel(item.durationMs)}</span>}
          {index === 8 && media.length > 9 && <span className="media-more">+{media.length - 9}</span>}
        </button>
      ))}
    </div>
  );
}

export { MediaThumbnail, MediaGrid };
