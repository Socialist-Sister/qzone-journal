import { useEffect, useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { getDemoStats } from "../../mockArchive.js";
import { formatBackupRelativeTime } from "../../relativeTime.js";

function Home({ onStart, archive }) {
  const archiveCount = archive ? getDemoStats(archive).total : 0;
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now());

  useEffect(() => {
    if (!archive?.lastBackupAt) return undefined;
    setRelativeTimeNow(Date.now());
    const timer = window.setInterval(() => setRelativeTimeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [archive?.lastBackupAt]);

  const lastBackupLabel = archive?.lastBackupAt
    ? formatBackupRelativeTime(archive.lastBackupAt, relativeTimeNow)
    : archive?.importedAt || "时间未知";
  return (
    <section className="home-view" aria-labelledby="home-title">
      <div className="hero-copy">
        <h1 id="home-title">备份我的 QQ 空间</h1>
        <p className="hero-subtitle">把可读取的说说、配图与视频，安静地整理回本地</p>
        <p className="hero-description">
          应用内扫码登录，无需复制 Cookie，也不用安装浏览器扩展。
        </p>
        <div className="hero-actions">
          <button className="primary-action" onClick={onStart} type="button">
            <span>{archive ? "再次备份" : "快速开始"}</span>
          </button>
        </div>
        {archive && (
          <button className="last-backup" type="button" onClick={onStart}>
            <ClockCounterClockwise size={18} />
            <span>上次备份：{lastBackupLabel} · {archiveCount} 条内容</span>
          </button>
        )}
      </div>
      <div className="hero-visual" aria-hidden="true">
        <img
          src="./assets/memory-collage.png"
          alt=""
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
        />
      </div>
    </section>
  );
}

export { Home };
