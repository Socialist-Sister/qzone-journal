const fs = require("node:fs/promises");
const path = require("node:path");
const {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} = require("docx");
const { normalizeQzoneMentions } = require("../collector/qzone-parser.cjs");
const { qzoneEmotionLabel } = require("./qzone-emotion-names.cjs");

const EXPORT_FORMATS = new Set(["html", "pdf", "docx"]);
const EXPORT_SCOPES = new Set(["all", "filtered", "dates"]);
const EXPORT_MEDIA = new Set(["original", "compact", "omit"]);
const EXPORT_TYPES = new Set(["all", "post", "journal", "album"]);
const MAX_SINGLE_MEDIA_BYTES = 100 * 1024 * 1024;

function safeText(value, limit = 200000) {
  return normalizeQzoneMentions(String(value || ""))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, limit);
}

function sanitizeExportOptions(input = {}) {
  const format = EXPORT_FORMATS.has(input.format) ? input.format : "html";
  const scope = EXPORT_SCOPES.has(input.scope) ? input.scope : "all";
  const type = EXPORT_TYPES.has(input.type) ? input.type : "all";
  const media = EXPORT_MEDIA.has(input.media) ? input.media : "compact";
  const query = safeText(input.query, 200).trim();
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
  return {
    format,
    scope,
    type,
    query,
    dateFrom: validDate(input.dateFrom),
    dateTo: validDate(input.dateTo),
    includeComments: input.includeComments !== false,
    includeLikes: input.includeLikes !== false,
    anonymize: input.anonymize !== false,
    media,
    confirmedPeople: input.confirmedPeople === true,
  };
}

function safeHttpsLinks(links) {
  return (Array.isArray(links) ? links : []).flatMap((link) => {
    try {
      const parsed = new URL(String(link?.url || ""));
      if (parsed.protocol !== "https:") return [];
      const qqOwnedHost = parsed.hostname === "qq.com" || parsed.hostname.endsWith(".qq.com") || parsed.hostname.endsWith(".gtimg.cn");
      if (qqOwnedHost && /\/(?:u\/)?\d{5,12}(?:\/|$)/.test(parsed.pathname)) return [];
      for (const key of [...parsed.searchParams.keys()]) {
        if (/(^|_)(?:uin|qq|account|user)(_|$)/i.test(key)) parsed.searchParams.delete(key);
      }
      parsed.hash = "";
      return [{ url: parsed.toString(), label: safeText(link?.label || parsed.hostname, 200) }];
    } catch {
      return [];
    }
  }).slice(0, 20);
}

function exportDate(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.valueOf())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function filterEntries(entries, options) {
  const keyword = options.scope === "filtered" ? options.query.toLocaleLowerCase("zh-CN") : "";
  const type = options.scope === "filtered" ? options.type : "all";
  const from = options.scope === "dates" && options.dateFrom ? `${options.dateFrom}T00:00:00` : "";
  const to = options.scope === "dates" && options.dateTo ? `${options.dateTo}T23:59:59.999` : "";
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => {
      if (type !== "all" && entry.type !== type) return false;
      const createdAt = String(entry.createdAt || entry.date || "");
      if (from && createdAt < from) return false;
      if (to && createdAt > to) return false;
      if (!keyword) return true;
      const haystack = [entry.title, entry.text, entry.location, ...safeHttpsLinks(entry.links).map((link) => link.label)]
        .map((value) => safeText(value, 200000))
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      return haystack.includes(keyword);
    })
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function createAnonymizer(ownerNickname, enabled) {
  const cleanName = (value) => safeText(value, 80)
    .replace(/^@/, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim() || "QQ 好友";
  const owner = cleanName(ownerNickname);
  const canonicalName = (value) => cleanName(value).normalize("NFKC").toLocaleLowerCase("zh-CN");
  const ownerKey = canonicalName(owner);
  const aliases = new Map();
  const knownForms = new Map([[owner, owner]]);
  const anonymizeName = (value) => {
    const name = cleanName(value);
    const key = canonicalName(name);
    if (!enabled || key === ownerKey) {
      knownForms.set(name, name);
      knownForms.set(name.normalize("NFKC"), name);
      return name;
    }
    if (!aliases.has(key)) aliases.set(key, `好友 ${aliases.size + 1}`);
    const alias = aliases.get(key);
    knownForms.set(name, alias);
    knownForms.set(name.normalize("NFKC"), alias);
    return alias;
  };
  const anonymizeText = (value) => {
    let text = safeText(value);
    if (!enabled) return text;

    // Protect complete names already known for this post. QQ nicknames often
    // contain brackets, dots or symbols that a generic @ parser would split.
    const protectedMentions = [];
    for (const [name, alias] of [...knownForms].sort((left, right) => right[0].length - left[0].length)) {
      const mention = `@${name}`;
      if (!text.includes(mention)) continue;
      const token = `\uE000${protectedMentions.length}\uE001`;
      protectedMentions.push(`@${alias}`);
      text = text.replaceAll(mention, token);
    }
    text = text.replace(/@([^\s@，。！？、:：；;（）()\[\]{}<>]{1,80})/g, (_match, name) => `@${anonymizeName(name)}`);
    text = text.replace(/\uE000(\d+)\uE001/g, (_match, index) => protectedMentions[Number(index)] || "@QQ 好友");
    return text;
  };
  const anonymizeLabel = (value) => {
    let text = anonymizeText(value);
    if (!enabled) return text;
    for (const [name, alias] of [...knownForms].sort((left, right) => right[0].length - left[0].length)) {
      text = text.replaceAll(name, alias);
    }
    return text;
  };
  return { anonymizeName, anonymizeText, anonymizeLabel, primeName: anonymizeName, aliases };
}

function normalizeExportEntry(entry, options, ownerNickname) {
  // Anonymous numbering is local to one post. Pre-register visible people so
  // an author's full nickname and a later @mention always share one number.
  const anonymizer = createAnonymizer(ownerNickname, options.anonymize);
  if (options.includeComments) {
    for (const comment of Array.isArray(entry.comments) ? entry.comments : []) {
      anonymizer.primeName(comment?.authorName || comment?.author || comment?.name || "QQ 好友");
    }
  }
  if (options.includeLikes) {
    for (const like of Array.isArray(entry.likes) ? entry.likes : []) {
      anonymizer.primeName(like?.name || like?.nickname || like || "QQ 好友");
    }
  }
  const comments = options.includeComments ? (Array.isArray(entry.comments) ? entry.comments : []).map((comment) => ({
    authorName: anonymizer.anonymizeName(comment?.authorName || comment?.author || comment?.name || "QQ 好友"),
    text: anonymizer.anonymizeText(comment?.text || comment?.content),
  })) : [];
  const likes = options.includeLikes ? (Array.isArray(entry.likes) ? entry.likes : []).map((like) => (
    anonymizer.anonymizeName(like?.name || like?.nickname || like || "QQ 好友")
  )) : [];
  return {
    id: safeText(entry.sourceId || entry.id, 200),
    type: EXPORT_TYPES.has(entry.type) && entry.type !== "all" ? entry.type : "post",
    date: exportDate(entry.createdAt || entry.date),
    title: entry.title ? anonymizer.anonymizeText(entry.title) : "",
    text: anonymizer.anonymizeText(entry.text),
    location: anonymizer.anonymizeText(entry.location),
    links: safeHttpsLinks(entry.links).map((link) => ({ ...link, label: anonymizer.anonymizeLabel(link.label) })),
    media: Array.isArray(entry.media) ? entry.media : [],
    comments,
    likes,
    commentCount: Math.max(comments.length, Number(entry.metrics?.commentCount ?? entry.commentCount) || 0),
    likeCount: Math.max(likes.length, Number(entry.metrics?.likeCount ?? entry.likeCount) || 0),
  };
}

function buildExportModel({ entries, profileName, ownerNickname, exportedAt = new Date(), options }) {
  const sanitized = sanitizeExportOptions(options);
  if ((sanitized.includeComments || sanitized.includeLikes) && !sanitized.anonymize && !sanitized.confirmedPeople) {
    throw new Error("导出可见互动昵称前需要再次确认");
  }
  const filtered = filterEntries(entries, sanitized);
  if (!filtered.length) throw new Error("当前范围内没有可导出的内容");
  const normalizedEntries = filtered.map((entry) => normalizeExportEntry(entry, sanitized, ownerNickname));
  const ownerLabel = safeText(ownerNickname || profileName || "QQ 空间", 80).trim() || "QQ 空间";
  return {
    title: `${ownerLabel}的空间档案`,
    profileName: safeText(profileName || `${ownerLabel}的空间`, 120),
    exportedAt: exportDate(exportedAt),
    options: sanitized,
    entries: normalizedEntries,
    counts: {
      entries: normalizedEntries.length,
      comments: normalizedEntries.reduce((total, entry) => total + entry.comments.length, 0),
      likes: normalizedEntries.reduce((total, entry) => total + entry.likes.length, 0),
      media: sanitized.media === "omit" ? 0 : normalizedEntries.reduce((total, entry) => total + entry.media.length, 0),
    },
    privacyNote: sanitized.anonymize
      ? "互动昵称与正文中的好友提及已匿名化；本人昵称与动态内容保持原样。"
      : "此文件包含 QQ 当前返回的可见互动昵称，请谨慎分享。",
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlText(value) {
  return escapeHtml(value)
    .replace(/\[em\]e(\d{1,8})\[\/em\]/gi, (_match, code) => (
      `<span class="qq-emotion-text" title="QQ 表情 e${code}">${escapeHtml(qzoneEmotionLabel(code))}</span>`
    ))
    .replace(/\r?\n/g, "<br>");
}

function mimeFromPath(filePath, fallback = "application/octet-stream") {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp" })[extension] || fallback;
}

async function defaultMediaResolver(archiveRoot, media) {
  if (!media?.localPath) return null;
  const target = path.resolve(archiveRoot, ...String(media.localPath).split("/"));
  if (!target.startsWith(`${path.resolve(archiveRoot)}${path.sep}`)) return null;
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_SINGLE_MEDIA_BYTES) return null;
  return { data: await fs.readFile(target), mime: String(media.contentType || mimeFromPath(target)), width: 0, height: 0 };
}

async function resolveEntryMedia(model, archiveRoot, mediaResolver = defaultMediaResolver, onProgress = () => undefined) {
  if (model.options.media === "omit") {
    onProgress({ completed: 0, total: 0 });
    return model.entries.map(() => []);
  }
  const total = model.entries.reduce((sum, entry) => sum + entry.media.length, 0);
  if (!total) onProgress({ completed: 0, total: 0 });
  let completed = 0;
  const resolved = [];
  for (const entry of model.entries) {
    const entryMedia = [];
    for (const media of entry.media) {
      let item = null;
      try {
        item = await mediaResolver(archiveRoot, media, model.options.media);
      } catch {
        item = null;
      }
      if (item?.data?.length) entryMedia.push(item);
      completed += 1;
      onProgress({ completed, total });
    }
    resolved.push(entryMedia);
  }
  model.counts.media = resolved.reduce((total, items) => total + items.length, 0);
  return resolved;
}

function plainDocumentText(value) {
  return String(value || "").replace(/\[em\]e(\d{1,8})\[\/em\]/gi, (_match, code) => qzoneEmotionLabel(code));
}

async function renderHtmlExport({ model, archiveRoot, mediaResolver, onMediaProgress }) {
  const mediaByEntry = await resolveEntryMedia(model, archiveRoot, mediaResolver, onMediaProgress);
  const cards = model.entries.map((entry, entryIndex) => {
    const images = mediaByEntry[entryIndex].map((image, imageIndex) => (
      `<img src="data:${escapeHtml(image.mime)};base64,${image.data.toString("base64")}" alt="配图 ${imageIndex + 1}">`
    )).join("");
    const links = entry.links.length ? `<div class="links">${entry.links.map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`).join("")}</div>` : "";
    const likes = model.options.includeLikes ? `<section class="interaction"><strong>${entry.likeCount} 人点赞</strong>${entry.likes.length ? `<p>${entry.likes.map(escapeHtml).join("、")}</p>` : "<p>没有保存可见点赞者名单。</p>"}</section>` : "";
    const comments = model.options.includeComments ? `<section class="interaction"><strong>评论 ${entry.commentCount}</strong>${entry.comments.length ? entry.comments.map((comment) => `<p><b>${escapeHtml(comment.authorName)}</b>：${htmlText(comment.text)}</p>`).join("") : "<p>没有保存可见评论正文。</p>"}</section>` : "";
    return `<article class="entry"><header><span>${entry.type === "post" ? "说说" : entry.type === "journal" ? "日志" : "相册"}</span><time>${escapeHtml(entry.date)}</time></header>${entry.title ? `<h2>${htmlText(entry.title)}</h2>` : ""}<div class="body">${htmlText(entry.text) || "<i>（无文字）</i>"}</div>${entry.location ? `<p class="location">地点：${htmlText(entry.location)}</p>` : ""}${links}${images ? `<div class="media">${images}</div>` : ""}${likes}${comments}</article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><title>${escapeHtml(model.title)}</title>
<style>
@page{size:A4;margin:16mm 15mm 18mm}*{box-sizing:border-box}body{margin:0;color:#25282c;background:#f8f5ee;font-family:"Microsoft YaHei","PingFang SC",sans-serif;line-height:1.7}.cover,.entry{width:min(780px,calc(100% - 32px));margin:24px auto;padding:28px 34px;border:1px solid #e4ded2;border-radius:12px;background:#fffdf8;box-shadow:0 10px 26px rgba(77,67,49,.06)}.cover{padding:44px 38px}.kicker,header span{color:#3978c7;font-weight:700}.cover h1{margin:10px 0 8px;font:700 34px/1.25 "STZhongsong","SimSun",serif}.cover p{margin:4px 0;color:#757a80;font-size:13px}.privacy{margin-top:22px;padding-top:14px;border-top:1px solid #e8e2d8}header{display:flex;justify-content:space-between;gap:16px;color:#8a8d90;font-size:12px}.entry h2{margin:13px 0 8px;font-size:21px}.body{margin-top:14px;font:400 17px/1.9 "STZhongsong","SimSun",serif;overflow-wrap:anywhere}.body i{color:#999;font-style:normal}.location,.links a{font-size:12px}.location{color:#757a80}.links{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.links a{padding:5px 9px;border-radius:6px;color:#356da9;background:#edf4fb;text-decoration:none}.media{margin-top:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.media img{display:block;width:100%;max-height:480px;object-fit:contain;border-radius:7px;background:#f2efe8}.interaction{margin-top:18px;padding-top:13px;border-top:1px solid #e8e2d8}.interaction strong{font-size:13px}.interaction p{margin:7px 0 0;color:#666c72;font-size:12px;overflow-wrap:anywhere}.interaction b{color:#506d91}.qq-emotion-text{display:inline-block;padding:0 4px;border-radius:4px;color:#7c6848;background:#f1eadc;font-size:.78em}@media print{body{background:#fff}.cover,.entry{width:100%;margin:0 0 8mm;padding:0 0 7mm;border:0;border-bottom:1px solid #ddd;border-radius:0;box-shadow:none;break-inside:auto}.cover{break-after:page}.media img{break-inside:avoid}.interaction{break-inside:avoid}}
</style></head><body><section class="cover"><span class="kicker">QQ 空间本地档案</span><h1>${escapeHtml(model.title)}</h1><p>${model.counts.entries} 条内容 · ${model.counts.media} 张配图 · ${model.counts.comments} 条可见评论 · ${model.counts.likes} 位可见点赞者</p><p>导出时间：${escapeHtml(model.exportedAt)}</p><p class="privacy">${escapeHtml(model.privacyNote)}</p></section>${cards}</body></html>`;
}

function docxImageType(mime) {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp" })[String(mime || "").toLowerCase()] || null;
}

function imageDimensions(image) {
  const width = Math.max(1, Number(image.width) || 960);
  const height = Math.max(1, Number(image.height) || 640);
  const ratio = Math.min(1, 520 / width, 360 / height);
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

async function renderDocxExport({ model, archiveRoot, mediaResolver, onMediaProgress }) {
  const mediaByEntry = await resolveEntryMedia(model, archiveRoot, mediaResolver, onMediaProgress);
  const children = [
    new Paragraph({ text: "QQ 空间本地档案", style: "Kicker" }),
    new Paragraph({ text: model.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `${model.counts.entries} 条内容 · ${model.counts.media} 张配图 · ${model.counts.comments} 条可见评论 · ${model.counts.likes} 位可见点赞者`, style: "Meta" }),
    new Paragraph({ text: `导出时间：${model.exportedAt}`, style: "Meta" }),
    new Paragraph({ text: model.privacyNote, style: "Privacy" }),
  ];
  model.entries.forEach((entry, entryIndex) => {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      children: [new TextRun({ text: entry.type === "post" ? "说说" : entry.type === "journal" ? "日志" : "相册", bold: true, color: "3978C7" }), new TextRun({ text: `  ${entry.date}`, color: "868B90", size: 19 })],
    }));
    if (entry.title) children.push(new Paragraph({ text: plainDocumentText(entry.title), heading: HeadingLevel.HEADING_2, keepNext: true }));
    const bodyLines = plainDocumentText(entry.text || "（无文字）").split(/\r?\n/);
    for (const line of bodyLines) children.push(new Paragraph({ text: line || " ", style: "ArchiveBody" }));
    if (entry.location) children.push(new Paragraph({ text: `地点：${entry.location}`, style: "Meta" }));
    for (const link of entry.links) {
      children.push(new Paragraph({ children: [new ExternalHyperlink({ link: link.url, children: [new TextRun({ text: link.label, color: "356DA9", underline: {} })] })] }));
    }
    for (const image of mediaByEntry[entryIndex]) {
      const type = docxImageType(image.mime);
      if (!type) continue;
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 }, children: [new ImageRun({ type, data: image.data, transformation: imageDimensions(image) })] }));
    }
    if (model.options.includeLikes) {
      children.push(new Paragraph({ children: [new TextRun({ text: `${entry.likeCount} 人点赞`, bold: true, color: "30343A" })], spacing: { before: 150, after: 60 } }));
      children.push(new Paragraph({ text: entry.likes.length ? entry.likes.join("、") : "没有保存可见点赞者名单。", style: "Interaction" }));
    }
    if (model.options.includeComments) {
      children.push(new Paragraph({ children: [new TextRun({ text: `评论 ${entry.commentCount}`, bold: true, color: "30343A" })], spacing: { before: 150, after: 60 } }));
      if (entry.comments.length) {
        for (const comment of entry.comments) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `${comment.authorName}：`, bold: true, color: "506D91" }), new TextRun(plainDocumentText(comment.text))] }));
      } else children.push(new Paragraph({ text: "没有保存可见评论正文。", style: "Interaction" }));
    }
    children.push(new Paragraph({ border: { bottom: { color: "DED8CD", style: BorderStyle.SINGLE, size: 4, space: 8 } }, spacing: { after: 180 } }));
  });
  const document = new Document({
    creator: "空间备份",
    title: model.title,
    description: "由空间备份生成的本地 QQ 空间档案",
    styles: {
      default: { document: { run: { font: { ascii: "Microsoft YaHei", eastAsia: "Microsoft YaHei", hAnsi: "Microsoft YaHei" }, size: 22, color: "2A2D31" }, paragraph: { spacing: { after: 100, line: 340 } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: { ascii: "SimSun", eastAsia: "SimSun", hAnsi: "SimSun" }, size: 48, bold: true, color: "25282C" }, paragraph: { spacing: { before: 80, after: 160 }, keepNext: true } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { size: 27, bold: true, color: "30343A" }, paragraph: { spacing: { before: 300, after: 100 }, keepNext: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { size: 30, bold: true, color: "25282C" }, paragraph: { spacing: { before: 80, after: 100 }, keepNext: true } },
        { id: "Kicker", name: "Kicker", basedOn: "Normal", next: "Title", run: { size: 20, bold: true, color: "3978C7" }, paragraph: { spacing: { after: 50 } } },
        { id: "Meta", name: "Meta", basedOn: "Normal", next: "Normal", run: { size: 19, color: "777D84" }, paragraph: { spacing: { after: 60 } } },
        { id: "Privacy", name: "Privacy", basedOn: "Normal", next: "Normal", run: { size: 19, color: "6E624F" }, paragraph: { spacing: { before: 180, after: 300 }, border: { top: { color: "DED8CD", style: BorderStyle.SINGLE, size: 4, space: 8 } } } },
        { id: "ArchiveBody", name: "Archive Body", basedOn: "Normal", next: "ArchiveBody", run: { font: { ascii: "SimSun", eastAsia: "SimSun", hAnsi: "SimSun" }, size: 25, color: "292C30" }, paragraph: { spacing: { after: 100, line: 440 } } },
        { id: "Interaction", name: "Interaction", basedOn: "Normal", next: "Normal", run: { size: 20, color: "666C72" }, paragraph: { spacing: { after: 70 } } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      headers: { default: new Header({ children: [new Paragraph({ text: model.profileName, alignment: AlignmentType.RIGHT, style: "Meta" })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "空间备份 · ", color: "8C9094", size: 18 }), new TextRun({ children: [PageNumber.CURRENT], color: "8C9094", size: 18 })] })] }) },
      children,
    }],
  });
  return Packer.toBuffer(document);
}

module.exports = {
  MAX_SINGLE_MEDIA_BYTES,
  buildExportModel,
  defaultMediaResolver,
  filterEntries,
  renderDocxExport,
  renderHtmlExport,
  sanitizeExportOptions,
};
