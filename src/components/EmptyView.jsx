

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

export { EmptyView };
