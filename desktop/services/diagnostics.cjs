const { app, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { ArchiveStore } = require("../archive/store.cjs");
const { listQzoneAccounts } = require("../qzone-session.cjs");
const { readAiConfig, normalizeStoredConfig } = require("../ai/config.cjs");
const { readArchiveIndex, assertArchiveRoot } = require("./archives.cjs");
const { defaultBackupDirectory, readAppPreferences } = require("./preferences.cjs");

function diagnosticCounts(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    entries: Math.max(0, Number(input.entries) || 0),
    media: Math.max(0, Number(input.media) || 0),
    mediaBytes: Math.max(0, Number(input.mediaBytes) || 0),
    comments: Math.max(0, Number(input.comments) || 0),
    likes: Math.max(0, Number(input.likes) || 0),
  };
}

async function buildDiagnosticBundle() {
  const preferences = await readAppPreferences();
  const aiConfig = normalizeStoredConfig(await readAiConfig());
  const accountState = await listQzoneAccounts();
  const index = await readArchiveIndex();
  const archives = [];
  for (const [accountId, item] of Object.entries(index.byAccount)) {
    const summary = {
      archiveKey: createHash("sha256").update(String(accountId)).digest("hex").slice(0, 10),
      readable: false,
      schemaVersion: null,
      collection: null,
      integrity: null,
      diagnostics: { files: 0, totalBytes: 0, lastModifiedAt: null },
    };
    try {
      const archiveRoot = await assertArchiveRoot(item.archiveRoot);
      const manifest = JSON.parse(await fs.readFile(path.join(archiveRoot, "manifest.json"), "utf8"));
      const integrity = await new ArchiveStore(archiveRoot).checkIntegrity();
      summary.readable = true;
      summary.schemaVersion = Number(manifest.schemaVersion) || null;
      summary.collection = {
        status: String(manifest.collection?.status || "unknown").slice(0, 40),
        parserVersion: Number(manifest.collection?.parserVersion) || null,
        counts: diagnosticCounts(manifest.collection?.counts),
        lastRunMode: ["full", "incremental"].includes(manifest.collection?.lastRun?.mode) ? manifest.collection.lastRun.mode : null,
        lastRunChanges: manifest.collection?.lastRun?.changes ? {
          added: Math.max(0, Number(manifest.collection.lastRun.changes.added) || 0),
          updated: Math.max(0, Number(manifest.collection.lastRun.changes.updated) || 0),
          skipped: Math.max(0, Number(manifest.collection.lastRun.changes.skipped) || 0),
        } : null,
      };
      summary.integrity = {
        corruptEntries: integrity.corruptEntries.length,
        missingMedia: integrity.missingMedia.length,
        unsafeMedia: integrity.unsafeMedia.length,
      };
      const diagnosticsDirectory = path.join(archiveRoot, "diagnostics");
      const names = await fs.readdir(diagnosticsDirectory).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
      const diagnosticStats = await Promise.all(names
        .filter((name) => /^[a-z0-9-]+\.json$/i.test(name))
        .slice(0, 100)
        .map(async (name) => {
          const stat = await fs.stat(path.join(diagnosticsDirectory, name));
          return { bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
        }));
      summary.diagnostics = {
        files: diagnosticStats.length,
        totalBytes: diagnosticStats.reduce((total, item) => total + item.bytes, 0),
        lastModifiedAt: diagnosticStats
          .map((item) => item.modifiedAt)
          .sort((left, right) => right.localeCompare(left))[0] || null,
      };
    } catch (error) {
      summary.errorCategory = error instanceof SyntaxError ? "manifest_json_invalid" : "archive_unreadable";
    }
    archives.push(summary);
  }
  return {
    format: "qzone-journal-redacted-diagnostics",
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    app: { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged },
    configuration: {
      usesDefaultBackupDirectory: path.resolve(preferences.backupDirectory) === path.resolve(defaultBackupDirectory()),
      knownBackupDirectoryCount: preferences.knownBackupDirectories.length,
      aiProviderCount: aiConfig.providers.length,
      aiModelCount: aiConfig.providers.reduce((total, provider) => total + provider.models.length, 0),
    },
    accounts: { count: accountState.accounts.length, archiveCount: Object.keys(index.byAccount).length },
    archives,
    privacy: {
      excludes: ["QQ Cookie", "完整 QQ 号", "API Key", "归档正文", "评论与点赞人员", "QQ 原始响应", "本地绝对路径"],
    },
  };
}

async function exportDiagnosticBundle(owner) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const result = await dialog.showSaveDialog(owner, {
    title: "导出脱敏诊断包",
    defaultPath: path.join(app.getPath("documents"), `空间备份-脱敏诊断-${date}.json`),
    filters: [{ name: "JSON 诊断文件", extensions: ["json"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (result.canceled || !result.filePath) return { exported: false };
  const target = path.resolve(result.filePath);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const bundle = await buildDiagnosticBundle();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
  return { exported: true, fileName: path.basename(target), archiveCount: bundle.archives.length };
}

module.exports = { diagnosticCounts, buildDiagnosticBundle, exportDiagnosticBundle };
