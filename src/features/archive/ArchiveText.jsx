import { useState } from "react";
import { Smiley } from "@phosphor-icons/react";

function normalizeArchiveMentions(value) {
  const source = String(value || "");
  return source.replace(/@\{([^{}\r\n]*)\}/g, (match, fields, offset) => {
    const nickname = String(fields)
      .match(/(?:^|,)\s*nick\s*:\s*([\s\S]*?)(?=,\s*(?:uin|who|auto)\s*:|$)/i)?.[1]
      ?.trim();
    const nextCharacter = source.slice(offset + match.length, offset + match.length + 1);
    const needsSpace = Boolean(nextCharacter) && !/[\s,，.。!?！？:：;；、)）\]】}]/.test(nextCharacter);
    return `${nickname ? `@${nickname}` : "@QQ好友"}${needsSpace ? " " : ""}`;
  });
}

function ArchiveText({ text }) {
  const parts = normalizeArchiveMentions(text).split(/(\[em\]e\d+\[\/em\]|\[QQ表情\])/gi);
  return parts.map((part, index) => {
    const match = part.match(/^\[em\]e(\d+)\[\/em\]$/i);
    if (match) return <QqEmotion code={match[1]} key={`qq-emotion-${match[1]}-${index}`} />;
    if (/^\[QQ表情\]$/i.test(part)) return <QqEmotion key={`qq-emotion-fallback-${index}`} />;
    return part;
  });
}

function QqEmotion({ code }) {
  const [failed, setFailed] = useState(false);
  if (!code || failed) {
    return (
      <span className="qq-emotion-fallback" role="img" aria-label="QQ 表情" title="QQ 表情">
        <Smiley size="1em" weight="duotone" />
      </span>
    );
  }
  return (
    <img
      className="qq-emotion"
      src={`https://qzonestyle.gtimg.cn/qzone/em/e${code}.gif`}
      alt="QQ 表情"
      title={`QQ 表情 e${code}`}
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export { ArchiveText };
