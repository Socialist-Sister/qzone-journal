import { useEffect, useRef, useState } from "react";
import { Archive, BookmarkSimple, CaretDown, Check, GearSix, House, Minus, Plus, Sparkle, Square, Trash, UserCircle, X, CornersIn } from "@phosphor-icons/react";
import { LoadingSpinner } from "./LoadingSpinner.jsx";

const navItems = [
  { id: "home", label: "首页", icon: House },
  { id: "archive", label: "我的档案", icon: Archive },
  { id: "review", label: "AI 回顾", icon: Sparkle },
  { id: "settings", label: "设置", icon: GearSix },
];

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="空间备份">
      <Archive size={30} weight="fill" />
    </div>
  );
}

function accountDisplayName(account) {
  return account?.nickname || account?.accountLabel || (account?.uin ? `QQ ${account.uin}` : "QQ 账号");
}

function AccountAvatar({ account, className }) {
  const avatarUrl = String(account?.avatarUrl || "");
  const safeAvatarUrl = avatarUrl.startsWith("https://q.qlogo.cn/headimg_dl?") ? avatarUrl : "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [safeAvatarUrl]);
  return (
    <span className={className}>
      {safeAvatarUrl && <img className={`account-avatar-image ${failed ? "failed" : ""}`} src={safeAvatarUrl} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
      {(!safeAvatarUrl || failed) && <UserCircle size={className === "account-trigger-icon" ? 18 : 20} weight="fill" />}
    </span>
  );
}

function TitleBar({ activeView, onNavigate, onWindowAction, isMaximized, accountState, accountBusy, onSwitchAccount, onAddAccount, onDeleteAccount }) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState("");
  const accountMenuRef = useRef(null);
  const activeAccount = accountState.accounts.find((account) => account.id === accountState.activeAccountId)
    || accountState.accounts[0];
  const deleteCandidate = accountState.accounts.find((account) => account.id === deleteCandidateId);

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

  useEffect(() => {
    if (!accountMenuOpen) setDeleteCandidateId("");
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
            <AccountAvatar account={activeAccount} className="account-trigger-icon" />
            <span className="account-trigger-label">{accountDisplayName(activeAccount)}</span>
            <span className={`account-status-dot ${activeAccount?.hasArchive ? "archived" : ""}`} aria-hidden="true" />
            <CaretDown className="account-caret" size={14} />
          </button>
          {accountMenuOpen && (
            <div className="account-menu" role="menu" aria-label="QQ 账号">
              <div className="account-menu-heading">
                <strong>QQ 档案</strong>
                <span>切换本地档案；备份结束后自动退出 QQ</span>
              </div>
              <div className="account-menu-list">
                {accountState.accounts.map((account) => (
                  <div className={`account-menu-row ${account.active ? "active" : ""}`} key={account.id}>
                    <button
                      className="account-menu-item"
                      type="button"
                      role="menuitemradio"
                      aria-checked={account.active}
                      disabled={accountBusy}
                      onClick={async () => {
                        await onSwitchAccount(account.id);
                        setAccountMenuOpen(false);
                      }}
                    >
                      <AccountAvatar account={account} className="account-avatar" />
                      <span className="account-menu-copy">
                        <strong>{accountDisplayName(account)}</strong>
                        <small>{account.uin ? `QQ ${account.uin}` : "QQ 号待识别"}</small>
                      </span>
                      {account.active && <Check size={16} weight="bold" />}
                    </button>
                    <button className="account-delete" type="button" aria-label={`删除 ${accountDisplayName(account)} 的全部数据`} title="删除账号数据" disabled={accountBusy} onClick={() => setDeleteCandidateId(account.id)}>
                      <Trash size={16} />
                    </button>
                  </div>
                ))}
              </div>
              {deleteCandidate && (
                <div className="account-delete-confirm" role="alertdialog" aria-label="确认删除账号全部数据">
                  <strong>删除 {accountDisplayName(deleteCandidate)} 的全部数据？</strong>
                  <span>该 QQ 的本地档案入口会被移除，对应档案将移入系统回收站。</span>
                  <code>{deleteCandidate.archivePath || "当前账号尚无本地档案"}</code>
                  <div>
                    <button type="button" disabled={accountBusy} onClick={() => setDeleteCandidateId("")}>取消</button>
                    <button className="confirm-delete" type="button" disabled={accountBusy} onClick={async () => {
                      const deleted = await onDeleteAccount(deleteCandidate.id);
                      if (deleted) {
                        setDeleteCandidateId("");
                        setAccountMenuOpen(false);
                      }
                    }}>{accountBusy ? <LoadingSpinner size={14} /> : <Trash size={14} />}删除全部数据</button>
                  </div>
                </div>
              )}
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
                <span>{accountBusy ? "正在连接…" : "添加另一个 QQ 档案"}</span>
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

export { BrandMark, TitleBar };
