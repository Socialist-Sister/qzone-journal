import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowsClockwise,
  ArrowRight,
  BookmarkSimple,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  ChatsCircle,
  ClockCounterClockwise,
  Code,
  FolderOpen,
  GearSix,
  HardDrive,
  Heart,
  House,
  Images,
  Info,
  Key,
  LockKey,
  MagnifyingGlass,
  MapPin,
  Minus,
  NotePencil,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Robot,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  SpinnerGap,
  Square,
  Trash,
  UploadSimple,
  UserCircle,
  WarningCircle,
  X,
  CornersIn,
} from "@phosphor-icons/react";
import { demoArchive, getDemoStats } from "./mockArchive";
import { formatBackupRelativeTime } from "./relativeTime";

const navItems = [
  { id: "home", label: "首页", icon: House },
  { id: "archive", label: "我的档案", icon: Archive },
  { id: "review", label: "AI 回顾", icon: Sparkle },
  { id: "settings", label: "设置", icon: GearSix },
];

const backupOptions = [
  { id: "posts", label: "说说正文与配图", description: "正文、发布时间和说说中可读取的原图", icon: NotePencil },
  { id: "comments", label: "评论与回复", description: "保存页面当前可见的评论与回复", icon: ChatsCircle },
  { id: "likes", label: "点赞记录", description: "保存页面当前可见的点赞者", icon: Heart },
];

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="空间备份">
      <Archive size={30} weight="fill" />
    </div>
  );
}

function LoadingSpinner({ size = 17 }) {
  return <span className="loading-spinner" style={{ width: size, height: size }} aria-hidden="true"><SpinnerGap size={size} /></span>;
}

function TitleBar({ activeView, onNavigate, onWindowAction, isMaximized, accountState, accountBusy, onSwitchAccount, onAddAccount }) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const activeAccount = accountState.accounts.find((account) => account.id === accountState.activeAccountId)
    || accountState.accounts[0];

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const closeOutside = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false);
    };
    const closeWithEscape = (event) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [accountMenuOpen]);

  return (
    <header
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={(event) => {
        if (!event.target.closest("button, [role='menu']")) onWindowAction("toggleMaximize");
      }}
    >
      <button className="titlebar-brand" type="button" onClick={() => onNavigate("home")} aria-label="空间备份首页">
        <span className="titlebar-brand-icon"><Archive size={24} weight="fill" /></span>
        <span>空间备份</span>
      </button>
      <nav className="titlebar-nav" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              className={`titlebar-nav-item ${isActive ? "active" : ""}`}
              aria-label={item.label}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              {isActive
                ? <BookmarkSimple className="active-bookmark" size={21} weight="fill" />
                : <Icon size={21} weight="regular" />}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="titlebar-utilities">
        <div className="account-switcher" ref={accountMenuRef}>
          <button
            className={`account-trigger ${accountMenuOpen ? "open" : ""}`}
            type="button"
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            aria-label="切换 QQ 账号"
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            <span className="account-trigger-icon"><UserCircle size={18} weight="fill" /></span>
            <span className="account-trigger-label">{activeAccount?.accountLabel || "QQ 账号"}</span>
            <span className={`account-status-dot ${activeAccount?.authenticated ? "online" : ""}`} aria-hidden="true" />
            <CaretDown className="account-caret" size={14} />
          </button>
          {accountMenuOpen && (
            <div className="account-menu" role="menu" aria-label="QQ 账号">
              <div className="account-menu-heading">
                <strong>QQ 账号</strong>
                <span>会话彼此独立保存在本机</span>
              </div>
              <div className="account-menu-list">
                {accountState.accounts.map((account) => (
                  <button
                    className={`account-menu-item ${account.active ? "active" : ""}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={account.active}
                    disabled={accountBusy}
                    key={account.id}
                    onClick={async () => {
                      await onSwitchAccount(account.id);
                      setAccountMenuOpen(false);
                    }}
                  >
                    <span className="account-avatar"><UserCircle size={20} weight="fill" /></span>
                    <span className="account-menu-copy">
                      <strong>{account.accountLabel}</strong>
                      <small>{account.authenticated ? "会话可用" : "需要重新扫码"}</small>
                    </span>
                    {account.active && <Check size={16} weight="bold" />}
                  </button>
                ))}
              </div>
              <button
                className="account-add"
                type="button"
                role="menuitem"
                disabled={accountBusy}
                onClick={async () => {
                  await onAddAccount();
                  setAccountMenuOpen(false);
                }}
              >
                {accountBusy ? <LoadingSpinner size={16} /> : <Plus size={16} weight="bold" />}
                <span>{accountBusy ? "正在连接…" : "添加另一个 QQ"}</span>
              </button>
            </div>
          )}
        </div>
        <div className="titlebar-controls" aria-label="窗口控制">
          <button type="button" aria-label="最小化" title="最小化" onClick={() => onWindowAction("minimize")}><Minus size={21} /></button>
          <button
            type="button"
            aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
            title={isMaximized ? "还原" : "最大化"}
            onClick={() => onWindowAction("toggleMaximize")}
          >
            {isMaximized ? <CornersIn size={18} /> : <Square size={17} />}
          </button>
          <button className="close" type="button" aria-label="关闭" title="关闭" onClick={() => onWindowAction("close")}><X size={21} /></button>
        </div>
      </div>
    </header>
  );
}

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
        <p className="hero-subtitle">把散落在空间里的记忆，完整带回本地</p>
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

function EmptyView({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
  onAction,
  secondaryAction,
  onSecondaryAction,
  note,
}) {
  return (
    <section className="utility-view">
      <div className="utility-heading">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="empty-state">
        <div className="empty-icon"><Icon size={34} weight="duotone" /></div>
        <h2>这里还很安静</h2>
        <p>完成第一次备份后，内容会按年份和类型自动整理在这里。</p>
        <div className="empty-actions">
          <button className="compact-action" type="button" onClick={onAction}>{action}</button>
          {secondaryAction && (
            <button className="empty-secondary-action" type="button" onClick={onSecondaryAction}>{secondaryAction}</button>
          )}
        </div>
        {note && <small className="empty-note">{note}</small>}
      </div>
    </section>
  );
}

const archiveFilters = [
  { id: "all", label: "全部" },
  { id: "post", label: "说说" },
  { id: "journal", label: "日志" },
  { id: "album", label: "相册" },
];

const entryTypeMeta = {
  post: { label: "说说", icon: NotePencil },
  journal: { label: "日志", icon: ChatsCircle },
  album: { label: "相册", icon: Images },
};

function MediaGrid({ images, onOpen }) {
  if (!images?.length) return null;
  const visibleImages = images.slice(0, 9);
  const visibleCount = visibleImages.length;
  return (
    <div className={`media-grid media-count-${visibleCount}`} aria-label={`共 ${images.length} 张图片`}>
      {visibleImages.map((src, index) => (
        <button type="button" key={`${src}-${index}`} onClick={() => onOpen(index)} aria-label={`查看第 ${index + 1} 张图片`}>
          <img src={src} alt="" draggable={false} />
          {index === 8 && images.length > 9 && <span className="media-more">+{images.length - 9}</span>}
        </button>
      ))}
    </div>
  );
}

function ImageViewer({ images, index, onChange, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onChange((index - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") onChange((index + 1) % images.length);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [images.length, index, onChange, onClose]);

  return (
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label="图片查看器" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="image-viewer-toolbar">
        <span>{index + 1} / {images.length}</span>
        <button type="button" onClick={onClose} aria-label="关闭图片查看器"><X size={24} /></button>
      </div>
      <div className="image-viewer-stage">
        {images.length > 1 && <button className="viewer-nav previous" type="button" onClick={() => onChange((index - 1 + images.length) % images.length)} aria-label="上一张"><CaretLeft size={30} /></button>}
        <img src={images[index]} alt={`第 ${index + 1} 张大图`} draggable={false} />
        {images.length > 1 && <button className="viewer-nav next" type="button" onClick={() => onChange((index + 1) % images.length)} aria-label="下一张"><CaretRight size={30} /></button>}
      </div>
      <div className="image-viewer-thumbnails" aria-label="图片缩略图">
        {images.map((src, thumbnailIndex) => (
          <button className={thumbnailIndex === index ? "active" : ""} type="button" key={`${src}-viewer-${thumbnailIndex}`} onClick={() => onChange(thumbnailIndex)} aria-label={`转到第 ${thumbnailIndex + 1} 张`}>
            <img src={src} alt="" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ArchiveView({ archive, onStart, onImportDemo }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [viewer, setViewer] = useState(null);
  const entries = archive?.entries ?? [];
  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesType = filter === "all" || entry.type === filter;
      const matchesQuery = !keyword || `${entry.title ?? ""} ${entry.text} ${entry.location ?? ""}`.toLowerCase().includes(keyword);
      return matchesType && matchesQuery;
    });
  }, [entries, filter, query]);

  if (!archive) {
    return (
      <EmptyView
        icon={Archive}
        eyebrow="个人档案"
        title="我的档案"
        description="按时间线浏览说说、日志、照片与互动。"
        action="载入演示档案"
        onAction={onImportDemo}
        secondaryAction="创建第一份备份"
        onSecondaryAction={onStart}
        note="演示档案包含虚构内容，不会读取你的 QQ 空间。"
      />
    );
  }

  const stats = getDemoStats(archive);
  const selectedEntry = visibleEntries.find((entry) => entry.id === selectedId) ?? visibleEntries[0];

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
        <div><strong>{stats.comments}</strong><span>评论</span></div>
        <div><strong>{stats.likes}</strong><span>点赞</span></div>
      </div>

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
        <div className="timeline-list" aria-label="档案时间线">
          {visibleEntries.length ? visibleEntries.map((entry) => {
            const TypeIcon = entryTypeMeta[entry.type].icon;
            const isSelected = selectedEntry?.id === entry.id;
            return (
              <button
                className={`timeline-entry ${isSelected ? "selected" : ""}`}
                key={entry.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className="timeline-type"><TypeIcon size={18} /></span>
                <span className="timeline-entry-copy">
                  <span className="timeline-date">{entry.displayDate}</span>
                  {entry.title && <strong>{entry.title}</strong>}
                  <span className={entry.title ? "timeline-excerpt" : "timeline-post-copy"}>{entry.text}</span>
                  <small>
                    {entry.images?.length ? <><Images size={14} />{entry.images.length}</> : null}
                    <Heart size={14} />{entry.likes.length}<ChatsCircle size={14} />{entry.comments.length}
                  </small>
                </span>
              </button>
            );
          }) : (
            <div className="archive-no-results">
              <MagnifyingGlass size={28} />
              <strong>没有找到相关内容</strong>
              <span>换一个关键词或内容类型试试。</span>
            </div>
          )}
        </div>

        <aside className="archive-detail" aria-live="polite">
          {selectedEntry ? (
            <>
              <div className="detail-heading">
                <span>{entryTypeMeta[selectedEntry.type].label}</span>
                <small>{selectedEntry.displayDate}</small>
                {selectedEntry.title && <h2>{selectedEntry.title}</h2>}
              </div>
              <p className={`detail-body ${selectedEntry.title ? "" : "titleless"}`}>{selectedEntry.text}</p>
              <MediaGrid images={selectedEntry.images} onOpen={(imageIndex) => setViewer({ images: selectedEntry.images, index: imageIndex })} />
              {selectedEntry.location && <p className="detail-location"><MapPin size={16} />{selectedEntry.location}</p>}
              <div className="detail-section">
                <strong><Heart size={17} />{selectedEntry.likes.length} 人点赞</strong>
                <p>{selectedEntry.likes.join("、")}</p>
              </div>
              <div className="detail-section">
                <strong><ChatsCircle size={17} />评论 {selectedEntry.comments.length}</strong>
                {selectedEntry.comments.length ? selectedEntry.comments.map((comment, index) => (
                  <p className="detail-comment" key={`${selectedEntry.id}-${index}`}><b>{comment.name}</b>{comment.text}</p>
                )) : <p>这条内容还没有评论。</p>}
              </div>
            </>
          ) : <p className="detail-placeholder">从左侧选择一条内容查看详情。</p>}
        </aside>
      </div>
      {viewer && (
        <ImageViewer
          images={viewer.images}
          index={viewer.index}
          onChange={(nextIndex) => setViewer((current) => ({ ...current, index: nextIndex }))}
          onClose={() => setViewer(null)}
        />
      )}
    </section>
  );
}

function readableError(error) {
  return String(error?.message || error || "操作失败")
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
}

function openProjectPage(pathname = "") {
  window.open(`https://github.com/Socialist-Sister/qzone-journal${pathname}`, "_blank", "noopener,noreferrer");
}

function formatFileSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function ModelPicker({ options, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef(null);
  const selected = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="review-model-picker" ref={pickerRef}>
      <span>本次使用</span>
      <button className={open ? "open" : ""} type="button" onClick={() => setOpen((current) => !current)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
        <span><small>{selected?.providerName}</small><strong>{selected?.model}</strong></span>
        <CaretDown size={16} weight="bold" />
      </button>
      {open && (
        <div className="model-picker-menu" role="listbox" aria-label="选择本次调用的模型">
          {options.map((option) => (
            <button className={option.key === selected?.key ? "selected" : ""} type="button" role="option" aria-selected={option.key === selected?.key} key={option.key} onClick={() => { onChange(option.key); setOpen(false); }}>
              <span><small>{option.providerName}</small><strong>{option.model}</strong></span>
              {option.key === selected?.key && <Check size={15} weight="bold" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArchiveAnswer({ text }) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (
    <div className="archive-answer-copy">
      {lines.map((line, index) => {
        const heading = /^(结论|档案依据|边界)[：:]\s*(.*)$/.exec(line);
        if (heading) return <p className="answer-section" key={`${line}-${index}`}><strong>{heading[1]}</strong>{heading[2] && <span>{heading[2]}</span>}</p>;
        if (/^[-•]\s+/.test(line)) return <p className="answer-evidence" key={`${line}-${index}`}><span>•</span><span>{line.replace(/^[-•]\s+/, "")}</span></p>;
        return <p key={`${line}-${index}`}>{line}</p>;
      })}
    </div>
  );
}

function ReviewView({ archive, aiConfig, onStart, onImportDemo, onOpenAiSettings }) {
  const [review, setReview] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState(0);
  const [generationError, setGenerationError] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const [archiveConversation, setArchiveConversation] = useState([]);
  const modelOptions = aiConfig?.modelOptions || [];
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const selectedModel = modelOptions.find((option) => option.key === selectedModelKey) || modelOptions[0];

  useEffect(() => {
    if (!modelOptions.some((option) => option.key === selectedModelKey)) setSelectedModelKey(modelOptions[0]?.key || "");
  }, [aiConfig, modelOptions, selectedModelKey]);

  useEffect(() => {
    setReview(null);
    setArchiveConversation([]);
    setGenerationError("");
  }, [archive]);

  useEffect(() => {
    if (!generating) {
      setGenerationPhase(0);
      return undefined;
    }
    const timers = [
      window.setTimeout(() => setGenerationPhase(1), 1500),
      window.setTimeout(() => setGenerationPhase(2), 4200),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [generating]);

  if (!archive) {
    return (
      <EmptyView
        icon={Sparkle}
        eyebrow="本地智能整理"
        title="AI 回顾"
        description="从自己的档案中发现主题、人物与特别时刻。"
        action="载入演示档案"
        onAction={onImportDemo}
        secondaryAction="创建第一份备份"
        onSecondaryAction={onStart}
        note="接入 AI 后才会生成回顾；模型服务可能产生费用。"
      />
    );
  }

  if (!aiConfig?.configured) {
    return (
      <section className="utility-view review-view">
        <div className="utility-heading">
          <span>本地智能整理</span>
          <h1>AI 回顾</h1>
          <p>接入你自己的模型服务后，才能根据档案生成回顾。</p>
        </div>
        <article className="ai-gate-card">
          <span className="ai-gate-icon"><Robot size={28} weight="fill" /></span>
          <div>
            <h2>尚未接入 AI</h2>
            <p>配置一个 OpenAI 兼容接口。API Key 将由桌面系统加密保存在本机。</p>
          </div>
          <button className="compact-action" type="button" onClick={onOpenAiSettings}>前往接入 AI</button>
          <small><WarningCircle size={14} />模型服务商可能按用量收费；生成前请确认其价格与隐私政策。</small>
        </article>
      </section>
    );
  }

  const stats = getDemoStats(archive);
  const selection = selectedModel ? { providerId: selectedModel.providerId, model: selectedModel.model } : null;
  const generationMessages = [
    "正在整理档案内容与互动摘要…",
    `正在调用 ${selectedModel?.model || "所选模型"}…`,
    "模型正在组织主题与时间线，请稍候…",
  ];
  const generateReview = async () => {
    if (!selection) {
      setGenerationError("请先选择要调用的模型。");
      return;
    }
    if (!window.desktop?.ai?.generateReview) {
      setGenerationError("请在桌面版中生成 AI 回顾，网页预览不会发送档案或 API Key。");
      return;
    }
    setGenerating(true);
    setGenerationError("");
    try {
      const result = await window.desktop.ai.generateReview({ archive, selection });
      setReview({ ...result.review, model: result.model, providerName: result.providerName, sourceCount: result.sourceCount });
      setArchiveConversation([]);
    } catch (error) {
      setGenerationError(readableError(error));
    } finally {
      setGenerating(false);
    }
  };

  const askArchive = async (event) => {
    event.preventDefault();
    const cleanQuestion = question.trim();
    if (!cleanQuestion || asking) return;
    if (!window.desktop?.ai?.askArchive) {
      setQuestionError("请在桌面版中向档案提问。");
      return;
    }
    setAsking(true);
    setQuestionError("");
    try {
      const context = archiveConversation.flatMap((item) => ([
        { role: "user", content: item.question },
        { role: "assistant", content: item.answer },
      ]));
      const result = await window.desktop.ai.askArchive({ archive, question: cleanQuestion, context, selection });
      setArchiveConversation((current) => [...current.slice(-3), { question: cleanQuestion, answer: result.answer }]);
      setQuestion("");
    } catch (error) {
      setQuestionError(readableError(error));
    } finally {
      setAsking(false);
    }
  };

  return (
    <section className="utility-view review-view">
      <div className="archive-heading-row">
        <div className="utility-heading">
          <span>本地智能整理</span>
          <h1>AI 回顾</h1>
          <p>本篇内容由人工智能模型生成，仅供回顾参考，不保证结论完整或准确。</p>
        </div>
        <div className="review-heading-tools">
          <ModelPicker options={modelOptions} value={selectedModel?.key || ""} onChange={setSelectedModelKey} disabled={generating || asking} />
          {review && (
            <div className="review-regenerate-control">
              <button className="review-regenerate-action" type="button" onClick={generateReview} disabled={generating}>
                {generating ? <><LoadingSpinner size={15} />重新生成中…</> : <><ArrowsClockwise size={15} />重新生成</>}
              </button>
            </div>
          )}
        </div>
      </div>

      {generating && (
        <div className="ai-generation-progress" role="status" aria-live="polite">
          <div><LoadingSpinner /><strong>{generationMessages[generationPhase]}</strong></div>
          <span className="ai-progress-track"><i /></span>
          <small>可以继续等待，界面不会卡住；生成时间取决于模型服务。</small>
        </div>
      )}
      {generationError && <p className="ai-inline-error review-global-error" role="alert">{generationError}</p>}

      {!review ? (
        <article className="ai-ready-card">
          <div className="ai-ready-copy">
            <span><Sparkle size={22} weight="fill" /></span>
            <div><h2>从 {stats.total} 条内容生成一篇回顾</h2><p>模型只会收到用于本次分析的档案文字与互动摘要，不会收到本地文件路径。</p></div>
          </div>
          <button className="compact-action" type="button" onClick={generateReview} disabled={generating}>
            {generating ? <><LoadingSpinner />正在生成…</> : "生成 AI 回顾"}
          </button>
          <small><WarningCircle size={14} />将把当前档案内容发送给你配置的模型服务商，并可能产生调用费用。</small>
        </article>
      ) : (
        <>
          <article className="review-lead">
            <Sparkle size={24} weight="fill" />
            <p>{review.headline}</p>
            <span>{review.summary}</span>
          </article>

          <div className="review-grid">
            <section className="review-paper-card">
              <h2>反复出现的主题</h2>
              <div className="theme-list">
                {review.themes.map((theme) => (
                  <div key={theme.name}>
                    <span><strong>{theme.name}</strong><small>{theme.note}</small></span>
                    <b>{theme.count}</b>
                  </div>
                ))}
              </div>
            </section>
            <section className="review-paper-card">
              <h2>时间里的转折</h2>
              <div className="moment-list">
                {review.moments.map((moment, index) => (
                  <div key={`${moment.year}-${index}`}><b>{moment.year}</b><span>{moment.text}</span></div>
                ))}
              </div>
            </section>
          </div>

          <section className="archive-question-card">
            <div className="archive-question-heading">
              <div><h2>向档案提问</h2><p>继续查找日期、人物和反复出现的线索；不回答档案以外的问题。</p></div>
              <span><LockKey size={15} />限定当前档案</span>
            </div>
            {archiveConversation.length > 0 && (
              <div className="archive-answer-list">
                {archiveConversation.map((item, index) => (
                  <article key={`${item.question}-${index}`}><strong>{item.question}</strong><ArchiveAnswer text={item.answer} /></article>
                ))}
              </div>
            )}
            <form className="archive-question-form" onSubmit={askArchive}>
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：我在哪些动态里提到过搬家？" rows={2} maxLength={1200} />
              <button type="submit" aria-label="向档案提问" disabled={asking || !question.trim()}>
                {asking ? <LoadingSpinner size={18} /> : <PaperPlaneTilt size={18} weight="fill" />}
              </button>
            </form>
            {questionError && <p className="ai-inline-error" role="alert">{questionError}</p>}
            <small>每次提问都会调用模型并可能产生费用；这里只保留最近 4 次问答。</small>
          </section>

          <div className="review-footnote"><Info size={16} />由 {review.providerName} · {review.model} 分析 {review.sourceCount} 条内容；结果可能存在遗漏或误判。</div>
        </>
      )}
    </section>
  );
}

function SettingsView({ section, onSectionChange, aiConfig, onAiConfigChange, archive, onRepairArchive, archiveRepairing }) {
  const [autoBackup, setAutoBackup] = useState(false);
  const [anonymous, setAnonymous] = useState(true);
  const [notice, setNotice] = useState("");
  const [backupDirectory, setBackupDirectory] = useState("文档/空间备份");
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [providerEditor, setProviderEditor] = useState(null);
  const [manualModel, setManualModel] = useState("");
  const [detectedModels, setDetectedModels] = useState([]);
  const [selectedDetectedModels, setSelectedDetectedModels] = useState([]);
  const [savingAi, setSavingAi] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testingModelProgress, setTestingModelProgress] = useState({ current: 0, total: 0 });
  const [modelTestResults, setModelTestResults] = useState([]);
  const [detectingModels, setDetectingModels] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState("");

  useEffect(() => {
    if (!window.desktop?.app?.getInfo) return;
    window.desktop.app.getInfo().then((info) => setAppVersion(info.version)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!window.desktop?.dialogs?.getBackupDirectory) return;
    window.desktop.dialogs.getBackupDirectory().then(setBackupDirectory).catch(() => undefined);
  }, []);

  const settingsSections = [
    { id: "general", label: "常规", icon: SlidersHorizontal },
    { id: "ai", label: "AI 接入", icon: Robot },
    { id: "privacy", label: "隐私与导出", icon: ShieldCheck },
    { id: "about", label: "关于", icon: Info },
  ];

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const chooseBackupDirectory = async () => {
    if (!window.desktop?.dialogs?.selectBackupDirectory) {
      showNotice("桌面版将在这里打开系统目录选择器");
      return;
    }
    try {
      const selectedPath = await window.desktop.dialogs.selectBackupDirectory();
      if (selectedPath) {
        setBackupDirectory(selectedPath);
        showNotice("保存位置已更新，后续备份将写入新目录");
      }
    } catch (error) {
      showNotice(readableError(error));
    }
  };

  const openBackupDirectory = async () => {
    if (!window.desktop?.dialogs?.openBackupDirectory) {
      showNotice("打开目录仅在桌面版中可用");
      return;
    }
    try {
      await window.desktop.dialogs.openBackupDirectory();
    } catch (error) {
      showNotice(readableError(error));
    }
  };

  const openProviderEditor = (provider = null) => {
    setProviderEditor(provider ? {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: "",
      models: [...provider.models],
      maskedKey: provider.maskedKey,
    } : { id: "", name: "", baseUrl: "", apiKey: "", models: [] });
    setManualModel("");
    setDetectedModels([]);
    setSelectedDetectedModels([]);
    setModelTestResults([]);
    setTestingModelProgress({ current: 0, total: 0 });
    setDeleteConfirmId("");
  };

  const closeProviderEditor = () => {
    setProviderEditor(null);
    setDetectedModels([]);
    setSelectedDetectedModels([]);
    setModelTestResults([]);
  };

  const updateProviderDraft = (field, value) => setProviderEditor((current) => ({ ...current, [field]: value }));

  const addManualModel = () => {
    const model = manualModel.trim();
    if (!model) return;
    setProviderEditor((current) => ({ ...current, models: [...new Set([...current.models, model])] }));
    setModelTestResults([]);
    setManualModel("");
  };

  const removeModel = (model) => {
    setProviderEditor((current) => ({ ...current, models: current.models.filter((item) => item !== model) }));
    setModelTestResults([]);
  };

  const mergeDetectedModels = () => {
    setProviderEditor((current) => ({ ...current, models: [...new Set([...current.models, ...selectedDetectedModels])] }));
    setSelectedDetectedModels([]);
    setModelTestResults([]);
  };

  const saveAiProvider = async () => {
    const method = providerEditor?.id ? "updateProvider" : "addProvider";
    if (!window.desktop?.ai?.[method]) {
      showNotice("请在桌面版中安全保存 AI 配置");
      return;
    }
    setSavingAi(true);
    try {
      const saved = await window.desktop.ai[method](providerEditor);
      onAiConfigChange(saved);
      closeProviderEditor();
      showNotice(providerEditor.id ? "模型服务已更新" : "模型服务已添加");
    } catch (error) {
      showNotice(readableError(error));
    } finally {
      setSavingAi(false);
    }
  };

  const testAiConnection = async () => {
    if (!window.desktop?.ai?.testConnection) {
      showNotice("连接测试仅在桌面版中可用");
      return;
    }
    const models = providerEditor?.models || [];
    if (!models.length) {
      showNotice("请先添加至少一个模型名称");
      return;
    }
    setTestingAi(true);
    setTestingModelProgress({ current: 0, total: models.length });
    setModelTestResults(models.map((model) => ({ model, status: "waiting", message: "等待测试" })));
    let passed = 0;
    try {
      for (let index = 0; index < models.length; index += 1) {
        const model = models[index];
        setTestingModelProgress({ current: index + 1, total: models.length });
        setModelTestResults((current) => current.map((item) => item.model === model ? { ...item, status: "testing", message: "正在连接" } : item));
        try {
          const result = await window.desktop.ai.testConnection({
            selection: { providerId: providerEditor.id, model },
            draft: { ...providerEditor, model },
          });
          passed += 1;
          setModelTestResults((current) => current.map((item) => item.model === model ? { ...item, status: "passed", message: result.message || "响应正常" } : item));
        } catch (error) {
          setModelTestResults((current) => current.map((item) => item.model === model ? { ...item, status: "failed", message: readableError(error) } : item));
        }
      }
      showNotice(passed === models.length ? `${passed} 个模型全部通过测试` : `${passed} 个通过，${models.length - passed} 个失败`);
    } finally {
      setTestingAi(false);
      setTestingModelProgress({ current: 0, total: models.length });
    }
  };

  const detectModels = async () => {
    if (!window.desktop?.ai?.detectModels) {
      showNotice("自动检测仅在桌面版中可用");
      return;
    }
    setDetectingModels(true);
    try {
      const result = await window.desktop.ai.detectModels({ providerId: providerEditor.id, draft: providerEditor });
      setDetectedModels(result.models);
      setSelectedDetectedModels(result.models.filter((model) => providerEditor.models.includes(model)));
      showNotice(`检测到 ${result.models.length} 个模型`);
    } catch (error) {
      showNotice(readableError(error));
    } finally {
      setDetectingModels(false);
    }
  };

  const deleteProvider = async (providerId) => {
    if (deleteConfirmId !== providerId) {
      setDeleteConfirmId(providerId);
      window.setTimeout(() => setDeleteConfirmId((current) => current === providerId ? "" : current), 3500);
      return;
    }
    if (!window.desktop?.ai?.deleteProvider) {
      showNotice("删除模型服务仅在桌面版中可用");
      return;
    }
    try {
      const updated = await window.desktop.ai.deleteProvider(providerId);
      onAiConfigChange(updated);
      if (providerEditor?.id === providerId) closeProviderEditor();
      setDeleteConfirmId("");
      showNotice("模型服务及其本机密钥已删除");
    } catch (error) {
      showNotice(readableError(error));
    }
  };

  return (
    <section className="utility-view settings-view">
      <div className="utility-heading">
        <span>偏好、隐私与应用信息</span>
        <h1>设置</h1>
        <p>管理本机备份方式，查看数据原则与项目信息。</p>
      </div>
      <div className="settings-layout">
        <nav className="settings-subnav" aria-label="设置分类">
          {settingsSections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={section === item.id ? "active" : ""}
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                type="button"
              >
                <Icon size={22} weight={section === item.id ? "fill" : "regular"} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {section === "general" && (
            <article className="settings-card">
              <h2>常规</h2>
              <div className="settings-list">
                <label>
                  <div><strong>自动提醒增量备份</strong><span>计划功能；当前 Alpha 不会在后台自动登录或提醒</span></div>
                  <input type="checkbox" checked={autoBackup} onChange={(event) => setAutoBackup(event.target.checked)} disabled />
                </label>
                <div className="settings-row settings-directory-row">
                  <div><strong>本地数据目录</strong><span>{backupDirectory}</span></div>
                  <div className="settings-directory-actions">
                    <button className="change-directory-action" type="button" onClick={chooseBackupDirectory}>更改位置</button>
                    <button className="open-directory-action" type="button" onClick={openBackupDirectory} aria-label="打开备份目录" title="打开备份目录"><FolderOpen size={22} /></button>
                  </div>
                </div>
                <div className="settings-row archive-maintenance-row">
                  <div>
                    <strong>本地档案完整性</strong>
                    <span>{!archive || archive.isDemo
                      ? "当前账号还没有可检查的本地档案"
                      : archive.integrity?.needsRepair
                        ? `已发现 ${archive.integrity.corruptEntries?.length || 0} 条损坏记录和 ${(archive.integrity.missingMedia?.length || 0) + (archive.integrity.unsafeMedia?.length || 0)} 个媒体文件问题`
                        : "检查记录格式和本地图片；只处理本地副本，不会修改 QQ 空间"}</span>
                  </div>
                  <button className="archive-maintenance-action" type="button" disabled={archiveRepairing || !archive || archive.isDemo} onClick={onRepairArchive}>
                    {archiveRepairing ? <><LoadingSpinner size={15} />正在检查…</> : "检查与修复"}
                  </button>
                </div>
              </div>
            </article>
          )}

          {section === "ai" && (
            <article className="settings-card ai-settings-card">
              <div className="ai-settings-heading">
                <div><h2>AI 接入</h2><p>可保存多个兼容服务与模型，生成回顾时再选择本次要调用的一项。</p></div>
                <button className="provider-add-action" type="button" onClick={() => openProviderEditor()}><Plus size={16} weight="bold" />添加服务</button>
              </div>

              <div className="provider-list" aria-label="已添加的模型服务">
                {(aiConfig?.providers || []).length === 0 ? (
                  <div className="provider-empty"><Robot size={24} weight="duotone" /><span><strong>还没有模型服务</strong><small>添加后可手动填写模型，也可从服务端自动检测。</small></span></div>
                ) : aiConfig.providers.map((provider) => (
                  <section className="provider-row" key={provider.id}>
                    <div className="provider-summary">
                      <span className="provider-status"><CheckCircle size={18} weight="fill" /></span>
                      <div><strong>{provider.name}</strong><small>{provider.baseUrl} · {provider.maskedKey}</small></div>
                    </div>
                    <div className="provider-models">
                      {provider.models.length ? provider.models.map((model) => <span key={model}>{model}</span>) : <em>尚未选择模型</em>}
                    </div>
                    <div className="provider-row-actions">
                      <button type="button" onClick={() => openProviderEditor(provider)}><PencilSimple size={15} />修改</button>
                      <button className={deleteConfirmId === provider.id ? "confirming" : ""} type="button" onClick={() => deleteProvider(provider.id)}><Trash size={15} />{deleteConfirmId === provider.id ? "再次点击确认" : "删除"}</button>
                    </div>
                  </section>
                ))}
              </div>

              {providerEditor && (
                <section className="provider-editor" aria-label={providerEditor.id ? "修改模型服务" : "添加模型服务"}>
                  <div className="provider-editor-heading"><div><strong>{providerEditor.id ? "修改模型服务" : "添加模型服务"}</strong><small>模型 ID 可手动添加，也可读取服务端列表后多选。</small></div><button type="button" onClick={closeProviderEditor} aria-label="关闭编辑" disabled={testingAi}><X size={18} /></button></div>
                  <div className="ai-field-list">
                    <label><span>服务名称</span><input type="text" value={providerEditor.name} onChange={(event) => updateProviderDraft("name", event.target.value)} placeholder="例如：OpenAI / DeepSeek / 本地模型" autoComplete="organization" /></label>
                    <label><span>服务地址</span><input type="url" value={providerEditor.baseUrl} onChange={(event) => updateProviderDraft("baseUrl", event.target.value)} placeholder="例如：https://api.openai.com/v1" autoComplete="url" /><small>填写兼容 Chat Completions 的 API 根地址，不包含 /chat/completions。</small></label>
                    <label><span>API Key</span><div className="ai-key-input"><Key size={18} /><input type="password" value={providerEditor.apiKey} onChange={(event) => updateProviderDraft("apiKey", event.target.value)} placeholder={providerEditor.maskedKey || "输入 API Key"} autoComplete="new-password" /></div><small>{providerEditor.id ? "留空将继续使用已安全保存的密钥。" : "仅由桌面端加密后保存在本机，不会写入档案。"}</small></label>
                    <div className="model-field">
                      <span>模型名称</span>
                      <div className="model-entry-row"><input type="text" value={manualModel} onChange={(event) => setManualModel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManualModel(); } }} placeholder="输入模型 ID 后添加" /><button type="button" onClick={addManualModel} disabled={testingAi || !manualModel.trim()}><Plus size={15} />添加</button><button type="button" onClick={detectModels} disabled={testingAi || detectingModels || !providerEditor.baseUrl.trim()}>{detectingModels ? <LoadingSpinner size={15} /> : <ArrowsClockwise size={15} />}自动检测</button></div>
                      <div className="selected-model-chips">{providerEditor.models.length ? providerEditor.models.map((model) => <button type="button" key={model} onClick={() => removeModel(model)} title="移除此模型" disabled={testingAi}><span>{model}</span><X size={13} /></button>) : <small>尚未添加模型；服务可以先保存，但 AI 回顾需至少选择一个模型。</small>}</div>
                    </div>
                  </div>

                  {detectedModels.length > 0 && (
                    <div className="detected-model-panel">
                      <div><strong>检测到的模型</strong><span>{selectedDetectedModels.length} / {detectedModels.length} 已选择</span></div>
                      <div className="detected-model-toolbar"><button type="button" onClick={() => setSelectedDetectedModels(detectedModels)}>全选</button><button type="button" onClick={() => setSelectedDetectedModels([])}>清空</button></div>
                      <div className="detected-model-list">{detectedModels.map((model) => { const checked = selectedDetectedModels.includes(model); return <label className={checked ? "selected" : ""} key={model}><input type="checkbox" checked={checked} onChange={() => setSelectedDetectedModels((current) => checked ? current.filter((item) => item !== model) : [...current, model])} /><span>{model}</span></label>; })}</div>
                      <button className="detected-merge-action" type="button" onClick={mergeDetectedModels} disabled={!selectedDetectedModels.length}>加入所选模型（{selectedDetectedModels.length}）</button>
                    </div>
                  )}

                  {modelTestResults.length > 0 && (
                    <div className="model-test-results" aria-live="polite">
                      <div><strong>模型测试结果</strong><span>{testingAi ? `正在测试 ${testingModelProgress.current}/${testingModelProgress.total}` : `${modelTestResults.filter((item) => item.status === "passed").length}/${modelTestResults.length} 通过`}</span></div>
                      <div>{modelTestResults.map((item) => (
                        <p className={item.status} key={item.model}>
                          {item.status === "passed" ? <CheckCircle size={16} weight="fill" /> : item.status === "failed" ? <WarningCircle size={16} weight="fill" /> : item.status === "testing" ? <LoadingSpinner size={16} /> : <ClockCounterClockwise size={16} />}
                          <span><strong>{item.model}</strong><small>{item.message}</small></span>
                        </p>
                      ))}</div>
                    </div>
                  )}

                  <div className="ai-settings-actions">
                    <button className="compact-action" type="button" onClick={saveAiProvider} disabled={testingAi || savingAi || !providerEditor.name.trim() || !providerEditor.baseUrl.trim()}>{savingAi ? <><LoadingSpinner size={16} />正在保存…</> : providerEditor.id ? "保存修改" : "添加服务"}</button>
                    <button className="outline-action" type="button" onClick={testAiConnection} disabled={testingAi || !providerEditor.baseUrl.trim() || !providerEditor.models.length}>{testingAi ? <><LoadingSpinner size={15} />正在测试 {testingModelProgress.current}/{testingModelProgress.total}</> : "测试模型"}</button>
                    <button className="editor-cancel-action" type="button" onClick={closeProviderEditor} disabled={testingAi}>取消</button>
                  </div>
                </section>
              )}

              <div className="ai-config-notes">
                <p><WarningCircle size={17} /><span><strong>可能产生费用</strong>保存配置本身不收费；“测试模型”会依次调用当前服务中已加入的每个模型，生成回顾和向档案提问也会产生调用，费用由模型服务商收取。</span></p>
                <p><LockKey size={17} /><span><strong>数据发送范围</strong>调用时会把相关档案文字与互动摘要发送给你配置的服务商，请先阅读其价格与隐私政策。</span></p>
              </div>
            </article>
          )}

          {section === "privacy" && (
            <article className="settings-card">
              <h2>隐私与导出</h2>
              <div className="settings-list">
                <label>
                  <div><strong>公开导出时匿名化好友</strong><span>计划功能；多格式导出尚未在当前 Alpha 中接入</span></div>
                  <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} disabled />
                </label>
                <div className="settings-info-row">
                  <ShieldCheck size={23} weight="fill" />
                  <div><strong>导出前再次确认</strong><span>后续接入导出时，将在包含互动人员信息前再次确认范围。</span></div>
                </div>
              </div>
            </article>
          )}

          {section === "about" && (
            <div className="about-stack">
              <article className="settings-card about-product-card">
                <h2>关于</h2>
                <div className="about-product">
                  <BrandMark />
                  <div className="about-product-copy">
                    <strong>空间备份</strong>
                    <span>把自己的 QQ 空间整理成可长期保存的本地档案</span>
                    <small>当前版本：{appVersion}</small>
                  </div>
                  <button className="outline-action" type="button" onClick={() => openProjectPage("/releases")}>检查更新</button>
                </div>
              </article>

              <article className="settings-card">
                <h2>数据与隐私</h2>
                <div className="principle-list">
                  <div><HardDrive size={23} /><p><strong>档案默认只保存在你的电脑中</strong><span>只有主动生成 AI 回顾或向档案提问时，相关文字才会发送给你配置的模型服务商。</span></p></div>
                  <div><ShieldCheck size={23} /><p><strong>登录过程保持透明</strong><span>当前版本只会打开 QQ 官方登录页面，不在后台保存你的登录密码。</span></p></div>
                  <div><Code size={23} /><p><strong>本地优先，开源透明</strong><span>采集、整理与桌面端逻辑已公开，方便审查和自行构建。</span></p></div>
                </div>
              </article>

              <article className="settings-card about-license-card">
                <div><h2>开源与许可</h2><p>项目以 MIT License 开源；当前为早期 Alpha，请在使用前阅读仓库中的能力边界与免责声明。</p></div>
                <button className="outline-action" type="button" onClick={() => openProjectPage()}>查看项目说明</button>
              </article>
            </div>
          )}
        </div>
        {notice && <div className="settings-notice" role="status">{notice}</div>}
      </div>
    </section>
  );
}

function DemoImportDialog({ onClose, onComplete }) {
  const [stage, setStage] = useState("ready");
  const [progress, setProgress] = useState(0);
  const stats = getDemoStats(demoArchive);

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
      <section className="backup-dialog demo-import-dialog" role="dialog" aria-modal="true" aria-labelledby="demo-dialog-title">
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

function BackupDialog({ onClose, onComplete, onAccountChange }) {
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
        return;
      }
      if (event.type === "cancelled") {
        activeJobIdRef.current = "";
        setCancelling(false);
        setFlowError(event.message || "采集任务已取消，恢复点已经保留");
        setStep("choose");
        return;
      }
      if (event.type === "error") {
        activeJobIdRef.current = "";
        setCancelling(false);
        if (event.phase === "authentication_required") {
          setForceReauthenticate(true);
          setFlowError(`QQ 会话需要刷新，已经保存 ${event.counts?.entries || 0} 条内容和恢复点。重新扫码后可以继续。`);
          setStep("connect");
        } else {
          setFlowError(event.message || "采集进程未能完成，请稍后重试");
          setStep("choose");
        }
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

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && step !== "progress") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, step]);

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

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && step !== "progress" && onClose()}>
      <section className="backup-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
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
                ? "应用将打开 QQ 官方登录页面。登录会话只保存在本机的独立会话分区中，应用不会读取你的密码。"
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
              ? <><p>本次新增 {collectionResult.changes?.added || 0} 条、更新 {collectionResult.changes?.updated || 0} 条、跳过 {collectionResult.changes?.skipped || 0} 条未变化内容；共保存 {collectionResult.counts?.media || 0} 张图片（{formatFileSize(collectionResult.counts?.mediaBytes)}）、{collectionResult.counts?.comments || 0} 条评论和 {collectionResult.counts?.likes || 0} 条可见点赞记录。</p><code className="archive-path">{collectionResult.archivePath}</code>{flowError && <p className="dialog-error" role="alert"><WarningCircle size={17} weight="fill" />{flowError}</p>}</>
              : <p>当前是演示数据。正式采集接入后，档案会保存在你选择的本地目录。</p>}
            <button className="dialog-primary" type="button" disabled={openingArchive} onClick={collectionResult ? openCollectedArchive : onComplete}>{openingArchive ? <><LoadingSpinner />正在读取档案…</> : <>{collectionResult ? "打开我的档案" : "查看我的档案"}<ArrowRight size={20} /></>}</button>
          </div>
        )}
      </section>
    </div>
  );
}

function loadSavedArchive() {
  try {
    if (window.localStorage.getItem("qzone-journal-demo-loaded") !== "true") return null;
    const lastBackupAt = window.localStorage.getItem("qzone-journal-demo-imported-at") || new Date().toISOString();
    return { ...demoArchive, lastBackupAt };
  } catch {
    return null;
  }
}

function rememberDemoArchive(archive) {
  try {
    window.localStorage.setItem("qzone-journal-demo-loaded", "true");
    window.localStorage.setItem("qzone-journal-demo-imported-at", archive.lastBackupAt);
  } catch {
    // The in-memory archive still works when local storage is unavailable.
  }
}

export function App() {
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

  return (
    <div className="app-shell">
      <TitleBar
        activeView={activeView}
        onNavigate={setActiveView}
        onWindowAction={handleWindowAction}
        isMaximized={isMaximized}
        accountState={accountState}
        accountBusy={accountBusy}
        onSwitchAccount={handleSwitchAccount}
        onAddAccount={handleAddAccount}
      />
      <main className="app-main">
        <div className="looseleaf-rail" aria-hidden="true">
          <img src="./assets/looseleaf-edge.png" alt="" draggable={false} />
        </div>
        {activeView === "home" && <Home onStart={() => start("app")} archive={archiveData} />}
        {activeView === "archive" && <ArchiveView archive={archiveData} onStart={() => start("app")} onImportDemo={() => setDemoDialogOpen(true)} />}
        <div className="persistent-view" hidden={activeView !== "review"}>
          <ReviewView key={accountState.activeAccountId || "default"} archive={archiveData} aiConfig={aiConfig} onOpenAiSettings={openAiSettings} onStart={() => start("app")} onImportDemo={() => setDemoDialogOpen(true)} />
        </div>
        {activeView === "settings" && <SettingsView section={settingsSection} onSectionChange={setSettingsSection} aiConfig={aiConfig} onAiConfigChange={setAiConfig} archive={archiveData} onRepairArchive={handleRepairArchive} archiveRepairing={archiveRepairing} />}
      </main>
      {dialogMethod && <BackupDialog onClose={() => setDialogMethod(null)} onComplete={complete} onAccountChange={refreshAccounts} />}
      {demoDialogOpen && <DemoImportDialog onClose={() => setDemoDialogOpen(false)} onComplete={completeDemoImport} />}
      {windowNotice && <div className="window-notice" role="status">{windowNotice}</div>}
    </div>
  );
}
