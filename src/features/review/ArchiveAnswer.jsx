

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

export { ArchiveAnswer };
