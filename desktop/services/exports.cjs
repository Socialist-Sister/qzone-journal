const { app, BrowserWindow, dialog, nativeImage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ArchiveStore } = require("../archive/store.cjs");
const { buildExportModel, defaultMediaResolver, renderDocxExport, renderHtmlExport, sanitizeExportOptions } = require("../archive/exporter.cjs");
const { getActiveQzoneAccountId } = require("../qzone-session.cjs");
const { readArchiveIndex, assertArchiveRoot, readArchiveIdentity } = require("./archives.cjs");

const exportJobs = new Set();
function sendArchiveExportProgress(sender, payload) {
  if (!sender || sender.isDestroyed()) return;
  sender.send("desktop:qzone:export-event", {
    progress: Math.max(0, Math.min(100, Number(payload?.progress) || 0)),
    phase: String(payload?.phase || "preparing").slice(0, 60),
    message: String(payload?.message || "正在准备导出…").slice(0, 300),
  });
}

function exportFileName(value) {
  return String(value || "QQ空间档案")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || "QQ空间档案";
}

async function atomicWriteExport(target, bytes) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  const previous = `${target}.${randomUUID()}.previous`;
  let movedPrevious = false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, bytes, { mode: 0o600 });
  try {
    await fs.rename(target, previous);
    movedPrevious = true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    if (movedPrevious) await fs.rename(previous, target).catch(() => undefined);
    throw error;
  }
  if (movedPrevious) await fs.rm(previous, { force: true }).catch(() => undefined);
}

function createExportMediaResolver(format) {
  return async (archiveRoot, media, strategy) => {
    const original = await defaultMediaResolver(archiveRoot, media);
    if (!original) return null;
    const image = nativeImage.createFromBuffer(original.data);
    if (image.isEmpty()) return format === "docx" ? null : original;
    const size = image.getSize();
    if (strategy === "compact") {
      const ratio = Math.min(1, 1280 / Math.max(size.width, size.height));
      const resized = ratio < 1 ? image.resize({
        width: Math.max(1, Math.round(size.width * ratio)),
        height: Math.max(1, Math.round(size.height * ratio)),
        quality: "good",
      }) : image;
      const resizedSize = resized.getSize();
      return { data: resized.toJPEG(84), mime: "image/jpeg", width: resizedSize.width, height: resizedSize.height };
    }
    if (format === "docx" && !["image/png", "image/jpeg", "image/gif", "image/bmp"].includes(String(original.mime).toLowerCase())) {
      return { data: image.toPNG(), mime: "image/png", width: size.width, height: size.height };
    }
    return { ...original, width: size.width, height: size.height };
  };
}

async function renderPdfExport(html, target) {
  const temporaryDirectory = await fs.mkdtemp(path.join(app.getPath("temp"), "qzone-journal-export-"));
  const htmlPath = path.join(temporaryDirectory, "archive.html");
  let printWindow = null;
  try {
    await fs.writeFile(htmlPath, html, { encoding: "utf8", mode: 0o600 });
    printWindow = new BrowserWindow({
      show: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        contextIsolation: true,
        javascript: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    await printWindow.loadFile(htmlPath);
    const pdf = await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    await atomicWriteExport(target, pdf);
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function exportLatestArchive(sender, owner, input = {}) {
  if (exportJobs.has(sender.id)) throw new Error("已有档案导出任务正在进行");
  exportJobs.add(sender.id);
  try {
    sendArchiveExportProgress(sender, { progress: 2, phase: "reading", message: "正在读取本地档案…" });
    const options = sanitizeExportOptions(input);
    const index = await readArchiveIndex();
    const accountId = String(await getActiveQzoneAccountId());
    const accountIndex = index.byAccount[accountId];
    if (!accountIndex?.archiveRoot) throw new Error("当前账号还没有可导出的本地档案");
    const archiveRoot = await assertArchiveRoot(accountIndex.archiveRoot);
    const store = new ArchiveStore(archiveRoot);
    const entries = await store.readEntries();
    const identity = await readArchiveIdentity(archiveRoot, entries);
    const ownerNickname = identity.nickname || accountIndex.nickname || "QQ 空间";
    const profileName = `${ownerNickname}的空间`;
    const model = buildExportModel({ entries, profileName, ownerNickname, options });
    const extension = options.format;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const result = await dialog.showSaveDialog(owner, {
      title: `导出${options.format === "html" ? "离线 HTML" : options.format.toUpperCase()}档案`,
      defaultPath: path.join(app.getPath("documents"), `${exportFileName(profileName)}-${date}.${extension}`),
      filters: [{
        name: options.format === "html" ? "离线 HTML 文件" : options.format === "pdf" ? "PDF 文档" : "Word 文档",
        extensions: [extension],
      }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return { exported: false };
    const target = path.extname(result.filePath).toLowerCase() === `.${extension}`
      ? path.resolve(result.filePath)
      : path.resolve(`${result.filePath}.${extension}`);
    sendArchiveExportProgress(sender, { progress: 8, phase: "reading", message: `正在整理 ${model.counts.entries} 条档案内容…` });
    const mediaResolver = createExportMediaResolver(options.format);
    const onMediaProgress = ({ completed, total }) => {
      const ratio = total ? completed / total : 1;
      sendArchiveExportProgress(sender, {
        progress: 12 + Math.round(ratio * 55),
        phase: "media",
        message: total ? `正在处理配图 ${completed}/${total}…` : "档案中没有需要处理的配图",
      });
    };
    if (options.format === "docx") {
      const document = await renderDocxExport({ model, archiveRoot, mediaResolver, onMediaProgress });
      sendArchiveExportProgress(sender, { progress: 86, phase: "writing", message: "正在写入 Word 文档…" });
      await atomicWriteExport(target, document);
    } else {
      const html = await renderHtmlExport({ model, archiveRoot, mediaResolver, onMediaProgress });
      if (options.format === "html") {
        sendArchiveExportProgress(sender, { progress: 86, phase: "writing", message: "正在写入离线 HTML…" });
        await atomicWriteExport(target, html);
      } else {
        sendArchiveExportProgress(sender, { progress: 76, phase: "printing", message: "正在排版并生成 PDF…" });
        await renderPdfExport(html, target);
      }
    }
    sendArchiveExportProgress(sender, { progress: 100, phase: "complete", message: "档案导出完成" });
    return {
      exported: true,
      fileName: path.basename(target),
      format: options.format,
      counts: model.counts,
      anonymized: options.anonymize,
    };
  } finally {
    exportJobs.delete(sender.id);
  }
}

module.exports = { sendArchiveExportProgress, exportFileName, atomicWriteExport, createExportMediaResolver, renderPdfExport, exportLatestArchive };
