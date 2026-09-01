const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, nativeImage } = require("electron");
const {
  buildExportModel,
  defaultMediaResolver,
  renderDocxExport,
  renderHtmlExport,
} = require("../desktop/archive/exporter.cjs");

async function run() {
  const projectRoot = path.resolve(__dirname, "..");
  const outputRoot = path.join(projectRoot, "tmp", "export-qa");
  const archiveRoot = path.join(outputRoot, "archive");
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(archiveRoot, "media", "files"), { recursive: true });
  await fs.copyFile(path.join(projectRoot, "public", "assets", "demo", "spring-blossom.png"), path.join(archiveRoot, "media", "files", "spring.png"));
  const entries = [
    {
      sourceId: "qa-1",
      type: "post",
      createdAt: "2026-08-29T12:30:00+08:00",
      text: "今天沿着河边慢慢走了一圈。风很轻，树影落在旧桥上，忽然觉得这座城市也有安静的一面。[em]e10264[/em]",
      location: "河畔旧桥",
      links: [{ url: "https://example.com/archive", label: "保存的外部链接" }],
      media: [{ localPath: "media/files/spring.png", contentType: "image/png" }],
      comments: [{ authorName: "阿程", text: "这张照片的颜色很好看，下次一起去。" }],
      likes: [{ name: "阿程" }, { name: "小周" }],
      metrics: { commentCount: 3, likeCount: 6 },
    },
    {
      sourceId: "qa-2",
      type: "post",
      createdAt: "2025-12-31T21:15:00+08:00",
      text: "普通的一年，因为认真生活而变得具体。重新捡起了搁置很久的阅读，也记录下许多原本会被忘记的小事。\n愿下一年依然保留一点耐心。",
      media: [],
      comments: [{ authorName: "小周", text: "新年快乐！" }],
      likes: [{ name: "阿程" }],
      metrics: { commentCount: 1, likeCount: 1 },
    },
    {
      sourceId: "qa-3",
      type: "post",
      createdAt: "2024-05-03T07:20:00+08:00",
      text: "清晨的栈道还没有什么人，海风把云层吹开了一点。",
      media: [{ localPath: "media/files/spring.png", contentType: "image/png" }],
      comments: [],
      likes: [],
      metrics: {},
    },
  ];
  const model = buildExportModel({ entries, profileName: "林屿的空间", ownerNickname: "林屿", options: { anonymize: true, media: "original", includeComments: true, includeLikes: true } });
  const mediaResolver = async (root, media) => {
    const resolved = await defaultMediaResolver(root, media);
    if (!resolved) return null;
    const image = nativeImage.createFromBuffer(resolved.data);
    return { ...resolved, ...image.getSize() };
  };
  const html = await renderHtmlExport({ model, archiveRoot, mediaResolver });
  const htmlPath = path.join(outputRoot, "archive-sample.html");
  const docxPath = path.join(outputRoot, "archive-sample.docx");
  const pdfPath = path.join(outputRoot, "archive-sample.pdf");
  await fs.writeFile(htmlPath, html, "utf8");
  await fs.writeFile(docxPath, await renderDocxExport({ model, archiveRoot, mediaResolver }));
  const printWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, javascript: false, sandbox: true, webSecurity: true } });
  try {
    await printWindow.loadFile(htmlPath);
    await fs.writeFile(pdfPath, await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
  } finally {
    printWindow.destroy();
  }
  process.stdout.write(`${JSON.stringify({ htmlPath, docxPath, pdfPath })}\n`);
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
