const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { ARCHIVE_SCHEMA_VERSION, createManifest, isoNow, normalizeArchiveEntry } = require("./schema.cjs");
const COLLECTOR_PARSER_VERSION = 6;
const PARSER_MIGRATION_STATE = "parser-migration-transaction.json";

async function listJsonNames(directory) {
  try {
    return (await fs.readdir(directory)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

function entryFileName(entry) {
  return `${createHash("sha256").update(`${entry.type}:${entry.sourceId}`).digest("hex")}.json`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function entryContentFingerprint(entry) {
  const projection = {
    sourceId: String(entry?.sourceId || ""),
    type: String(entry?.type || "post"),
    createdAt: String(entry?.createdAt || ""),
    updatedAt: entry?.updatedAt ? String(entry.updatedAt) : null,
    title: entry?.title ? String(entry.title) : null,
    text: String(entry?.text || ""),
    location: entry?.location ? String(entry.location) : null,
    visibility: String(entry?.visibility || "unknown"),
    media: (Array.isArray(entry?.media) ? entry.media : []).map((item) => ({
      sourceUrl: String(item?.sourceUrl || ""),
      type: String(item?.type || item?.contentType || ""),
    })),
    comments: (Array.isArray(entry?.comments) ? entry.comments : []).map((item) => ({
      name: String(item?.name || item?.author || ""),
      text: String(item?.text || item?.content || ""),
    })),
    likes: (Array.isArray(entry?.likes) ? entry.likes : []).map((item) => ({
      name: String(item?.name || item?.nickname || item || ""),
    })),
    metrics: entry?.metrics && typeof entry.metrics === "object" ? entry.metrics : {},
  };
  return createHash("sha256").update(JSON.stringify(stableValue(projection))).digest("hex");
}

function extensionForMedia(contentType, sourceUrl) {
  const byType = {
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
  };
  if (byType[contentType]) return byType[contentType];
  try {
    const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
    return /^\.(?:avif|gif|jpe?g|png|svg|webp)$/.test(extension) ? extension.replace(".jpeg", ".jpg") : ".bin";
  } catch {
    return ".bin";
  }
}

class ArchiveStore {
  constructor(rootPath) {
    this.rootPath = path.resolve(rootPath);
    this.manifestPath = path.join(this.rootPath, "manifest.json");
  }

  async initialize({ ownerUin, jobId, options }) {
    const directories = ["records/entries", "records/people", "media/files", "state", "diagnostics"];
    await Promise.all(directories.map((directory) => fs.mkdir(path.join(this.rootPath, directory), { recursive: true })));
    await this.recoverInterruptedParserMigration();

    const existing = await readJson(this.manifestPath);
    const existingCheckpoint = await readJson(path.join(this.rootPath, "state", "checkpoint.json"), {});
    const mediaIndexPath = path.join(this.rootPath, "media", "index.json");
    const existingMediaIndex = await readJson(mediaIndexPath, {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      items: {},
    });
    if (existing && existing.schemaVersion !== ARCHIVE_SCHEMA_VERSION) {
      throw new Error("暂不支持归档结构版本 " + existing.schemaVersion);
    }

    const previousParserVersion = existing
      ? Math.max(1, Number(existing.collection?.parserVersion || 1))
      : COLLECTOR_PARSER_VERSION;
    const migrationRequired = Boolean(existing && previousParserVersion < COLLECTOR_PARSER_VERSION);
    const manifest = createManifest({ ownerUin, jobId, options, existing });
    manifest.collection.parserVersion = migrationRequired ? previousParserVersion : COLLECTOR_PARSER_VERSION;
    if (migrationRequired) {
      manifest.collection.migrationPending = {
        fromParserVersion: previousParserVersion,
        toParserVersion: COLLECTOR_PARSER_VERSION,
      };
    }
    await atomicWriteJson(this.manifestPath, manifest);
    await atomicWriteJson(path.join(this.rootPath, "state", "checkpoint.json"), {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      jobId,
      phase: "initialized",
      cursors: !migrationRequired && (["collecting_posts", "cancelled", "failed", "partial"].includes(existingCheckpoint?.phase))
        ? existingCheckpoint.cursors || {}
        : {},
      counts: existingCheckpoint?.counts || existing?.collection?.counts || {},
      updatedAt: isoNow(),
    });
    await atomicWriteJson(mediaIndexPath, existingMediaIndex);
    return { manifest, migrationRequired, previousParserVersion };
  }

  async readParserMigrationState() {
    return readJson(path.join(this.rootPath, "state", PARSER_MIGRATION_STATE), null);
  }

  async recoverInterruptedParserMigration() {
    const transaction = await this.readParserMigrationState();
    if (!transaction || !["preparing", "in_progress"].includes(transaction.phase)) return null;
    return this.rollbackParserMigration(transaction, { reason: "startup_recovery" });
  }

  async beginParserMigration({ jobId }) {
    const manifest = await readJson(this.manifestPath);
    if (!manifest) throw new Error("归档清单不存在");
    const fromParserVersion = Math.max(1, Number(manifest.collection?.parserVersion || 1));
    if (fromParserVersion >= COLLECTOR_PARSER_VERSION) return null;

    const entriesDirectory = path.join(this.rootPath, "records", "entries");
    const previousEntryNames = await listJsonNames(entriesDirectory);
    const transactionId = randomUUID();
    const quarantineRelativePath = path.posix.join(
      "diagnostics",
      "migrations",
      "parser-v" + fromParserVersion + "-" + transactionId,
    );
    const quarantineDirectory = path.join(this.rootPath, ...quarantineRelativePath.split("/"));
    const previousDirectory = path.join(quarantineDirectory, "previous");
    const failedNewDirectory = path.join(quarantineDirectory, "failed-new");
    const statePath = path.join(this.rootPath, "state", PARSER_MIGRATION_STATE);
    const previousCheckpoint = await this.readCheckpoint();
    const transaction = {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      transactionId,
      jobId,
      phase: "preparing",
      fromParserVersion,
      toParserVersion: COLLECTOR_PARSER_VERSION,
      quarantineRelativePath,
      previousEntryNames,
      previousCheckpoint,
      previousCollection: manifest.collection,
      startedAt: isoNow(),
    };

    await fs.mkdir(previousDirectory, { recursive: true });
    await fs.mkdir(failedNewDirectory, { recursive: true });
    await atomicWriteJson(statePath, transaction);
    try {
      for (const name of previousEntryNames) {
        const source = path.join(entriesDirectory, name);
        if (await fileExists(source)) await fs.rename(source, path.join(previousDirectory, name));
      }
      transaction.phase = "in_progress";
      transaction.quarantinedEntries = previousEntryNames.length;
      await atomicWriteJson(statePath, transaction);
      manifest.collection = {
        ...manifest.collection,
        status: "migrating_parser",
        activeJobId: jobId,
        migrationPending: {
          transactionId,
          fromParserVersion,
          toParserVersion: COLLECTOR_PARSER_VERSION,
        },
        counts: { entries: 0, media: 0, mediaBytes: 0, comments: 0, likes: 0 },
      };
      await atomicWriteJson(this.manifestPath, manifest);
      await this.writeCheckpoint({
        jobId,
        phase: "parser_migration",
        cursors: {},
        counts: manifest.collection.counts,
      });
      return transaction;
    } catch (error) {
      await this.rollbackParserMigration(transaction, { reason: "migration_setup_failed" }).catch(() => undefined);
      throw error;
    }
  }

  async rollbackParserMigration(transaction, { reason = "collection_failed" } = {}) {
    if (!transaction?.quarantineRelativePath) return null;
    const entriesDirectory = path.join(this.rootPath, "records", "entries");
    const quarantineDirectory = path.join(this.rootPath, ...String(transaction.quarantineRelativePath).split("/"));
    const previousDirectory = path.join(quarantineDirectory, "previous");
    const failedNewDirectory = path.join(quarantineDirectory, "failed-new");
    await fs.mkdir(entriesDirectory, { recursive: true });
    await fs.mkdir(failedNewDirectory, { recursive: true });

    const previousNames = new Set(Array.isArray(transaction.previousEntryNames) ? transaction.previousEntryNames : []);
    for (const name of await listJsonNames(entriesDirectory)) {
      const previousWasMoved = await fileExists(path.join(previousDirectory, name));
      if (previousNames.has(name) && !previousWasMoved) continue;
      const suffix = await fileExists(path.join(failedNewDirectory, name)) ? "." + randomUUID() : "";
      await fs.rename(path.join(entriesDirectory, name), path.join(failedNewDirectory, name + suffix));
    }
    for (const name of await listJsonNames(previousDirectory)) {
      const target = path.join(entriesDirectory, name);
      if (await fileExists(target)) {
        await fs.rename(target, path.join(failedNewDirectory, name + "." + randomUUID()));
      }
      await fs.rename(path.join(previousDirectory, name), target);
    }

    const restoredCounts = await this.summarize();
    const manifest = await readJson(this.manifestPath);
    if (manifest && transaction.previousCollection) {
      manifest.collection = { ...transaction.previousCollection, counts: restoredCounts };
      manifest.updatedAt = isoNow();
      await atomicWriteJson(this.manifestPath, manifest);
    }
    const rollbackState = {
      ...transaction,
      phase: "rolled_back",
      rollbackReason: reason,
      rolledBackAt: isoNow(),
    };
    await atomicWriteJson(path.join(this.rootPath, "state", PARSER_MIGRATION_STATE), rollbackState);
    if (transaction.previousCheckpoint) await this.writeCheckpoint(transaction.previousCheckpoint);
    return {
      counts: restoredCounts,
      cursors: transaction.previousCheckpoint?.cursors || {},
    };
  }

  async commitParserMigration(transaction) {
    if (!transaction?.quarantineRelativePath) return null;
    const manifest = await readJson(this.manifestPath);
    if (!manifest) throw new Error("归档清单不存在");
    manifest.collection.parserVersion = COLLECTOR_PARSER_VERSION;
    delete manifest.collection.migrationPending;
    await atomicWriteJson(this.manifestPath, manifest);
    const committedState = {
      ...transaction,
      phase: "committed",
      committedAt: isoNow(),
    };
    await atomicWriteJson(path.join(this.rootPath, "state", PARSER_MIGRATION_STATE), committedState);
    await this.writeDiagnostic("parser-migration", {
      transactionId: transaction.transactionId,
      fromParserVersion: transaction.fromParserVersion,
      toParserVersion: transaction.toParserVersion,
      quarantinedEntries: transaction.quarantinedEntries || 0,
      quarantineRelativePath: transaction.quarantineRelativePath,
      status: "committed",
    });
    return committedState;
  }

  async mergeParserMigrationPrevious(transaction) {
    if (!transaction?.quarantineRelativePath) return this.summarize();
    const entriesDirectory = path.join(this.rootPath, "records", "entries");
    const previousDirectory = path.join(
      this.rootPath,
      ...String(transaction.quarantineRelativePath).split("/"),
      "previous",
    );
    await fs.mkdir(entriesDirectory, { recursive: true });
    for (const name of await listJsonNames(previousDirectory)) {
      const target = path.join(entriesDirectory, name);
      if (!(await fileExists(target))) await fs.copyFile(path.join(previousDirectory, name), target);
    }
    return this.summarize();
  }

  async inspectEntry(input, options = {}) {
    const normalizedInput = normalizeArchiveEntry(input);
    const filePath = path.join(this.rootPath, "records", "entries", entryFileName(normalizedInput));
    const existing = await readJson(filePath);
    const mergedInput = {
      ...input,
      comments: options.includeComments === false ? existing?.comments || [] : input?.comments,
      likes: options.includeLikes === false ? existing?.likes || [] : input?.likes,
      media: options.includeMedia === false ? existing?.media || input?.media : input?.media,
    };
    const entry = normalizeArchiveEntry(mergedInput);
    entry.contentFingerprint = entryContentFingerprint(entry);
    const existingFingerprint = existing
      ? String(existing.contentFingerprint || entryContentFingerprint(existing))
      : "";
    let existingMediaMissing = false;
    for (const media of Array.isArray(existing?.media) ? existing.media : []) {
      if (!media?.localPath) {
        if (options.includeMedia !== false && media?.sourceUrl) existingMediaMissing = true;
        continue;
      }
      const mediaPath = path.resolve(this.rootPath, ...String(media.localPath).split("/"));
      if (!mediaPath.startsWith(this.rootPath + path.sep) || !(await fileExists(mediaPath))) {
        existingMediaMissing = true;
        break;
      }
    }
    return {
      change: !existing ? "added" : existingFingerprint === entry.contentFingerprint && !existingMediaMissing ? "skipped" : "updated",
      entry,
      existing,
      filePath,
    };
  }

  async writeEntry(input) {
    const entry = normalizeArchiveEntry(input);
    entry.contentFingerprint = entryContentFingerprint(entry);
    const filePath = path.join(this.rootPath, "records", "entries", entryFileName(entry));
    const existing = await readJson(filePath);
    if (existing && String(existing.contentFingerprint || entryContentFingerprint(existing)) !== entry.contentFingerprint) {
      const revisionDirectory = path.join(this.rootPath, "diagnostics", "revisions", path.basename(filePath, ".json"));
      const revisionName = isoNow().replace(/[:.]/g, "-") + ".json";
      await atomicWriteJson(path.join(revisionDirectory, revisionName), existing);
    }
    await atomicWriteJson(filePath, entry);
    return { entry, filePath, change: !existing ? "added" : "updated" };
  }

  async writeMedia({ sourceUrl, bytes, contentType, finalUrl }) {
    const id = createHash("sha256").update(String(sourceUrl)).digest("hex");
    const extension = extensionForMedia(contentType, finalUrl || sourceUrl);
    const relativePath = path.posix.join("media", "files", `${id}${extension}`);
    const filePath = path.join(this.rootPath, ...relativePath.split("/"));
    try {
      await fs.access(filePath);
    } catch {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      await fs.writeFile(temporaryPath, bytes, { mode: 0o600 });
      await fs.rename(temporaryPath, filePath);
    }
    const indexPath = path.join(this.rootPath, "media", "index.json");
    const index = await readJson(indexPath, { schemaVersion: ARCHIVE_SCHEMA_VERSION, items: {} });
    index.items[id] = {
      sourceUrl: String(sourceUrl),
      finalUrl: String(finalUrl || sourceUrl),
      relativePath,
      contentType,
      size: bytes.length,
      storedAt: isoNow(),
    };
    await atomicWriteJson(indexPath, index);
    return index.items[id];
  }

  async getStoredMedia(sourceUrl) {
    const id = createHash("sha256").update(String(sourceUrl)).digest("hex");
    const index = await readJson(path.join(this.rootPath, "media", "index.json"), { items: {} });
    const item = index?.items?.[id];
    if (!item?.relativePath) return null;
    try {
      await fs.access(path.join(this.rootPath, ...String(item.relativePath).split("/")));
      return item;
    } catch {
      return null;
    }
  }

  async readCheckpoint() {
    return readJson(path.join(this.rootPath, "state", "checkpoint.json"), {});
  }

  async readEntries() {
    const directory = path.join(this.rootPath, "records", "entries");
    let names = [];
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const entries = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(directory, name))));
    return entries.filter(Boolean);
  }

  async summarize() {
    const entries = await this.readEntries();
    return entries.reduce((counts, entry) => {
      counts.entries += 1;
      counts.media += Array.isArray(entry.media) ? entry.media.filter((item) => item.localPath).length : 0;
      counts.mediaBytes += Array.isArray(entry.media)
        ? entry.media.reduce((total, item) => total + (item.localPath ? Number(item.size) || 0 : 0), 0)
        : 0;
      counts.comments += Array.isArray(entry.comments) ? entry.comments.length : 0;
      counts.likes += Array.isArray(entry.likes) ? entry.likes.length : 0;
      return counts;
    }, { entries: 0, media: 0, mediaBytes: 0, comments: 0, likes: 0 });
  }

  async checkIntegrity() {
    const entriesDirectory = path.join(this.rootPath, "records", "entries");
    const report = {
      checkedEntries: 0,
      corruptEntries: [],
      missingMedia: [],
      unsafeMedia: [],
    };
    for (const name of await listJsonNames(entriesDirectory)) {
      let entry;
      try {
        entry = JSON.parse(await fs.readFile(path.join(entriesDirectory, name), "utf8"));
      } catch (error) {
        report.corruptEntries.push({ fileName: name, reason: error instanceof SyntaxError ? "JSON 格式损坏" : "记录无法读取" });
        continue;
      }
      if (!entry?.sourceId || !["post", "journal", "album"].includes(entry?.type)) {
        report.corruptEntries.push({ fileName: name, reason: "记录缺少必要字段" });
        continue;
      }
      report.checkedEntries += 1;
      for (const media of Array.isArray(entry.media) ? entry.media : []) {
        if (!media?.localPath) continue;
        const localPath = String(media.localPath);
        const mediaPath = path.resolve(this.rootPath, ...localPath.split("/"));
        if (!mediaPath.startsWith(this.rootPath + path.sep)) {
          report.unsafeMedia.push({ fileName: name, localPath });
        } else if (!(await fileExists(mediaPath))) {
          report.missingMedia.push({ fileName: name, localPath });
        }
      }
    }
    return {
      ...report,
      needsRepair: report.corruptEntries.length + report.missingMedia.length + report.unsafeMedia.length > 0,
    };
  }

  async repairIntegrity() {
    const report = await this.checkIntegrity();
    if (!report.needsRepair) return { ...report, repairedEntries: 0, quarantinedEntries: 0, counts: await this.summarize() };

    const entriesDirectory = path.join(this.rootPath, "records", "entries");
    const repairId = isoNow().replace(/[:.]/g, "-");
    const quarantineDirectory = path.join(this.rootPath, "diagnostics", "integrity", repairId, "corrupt-entries");
    await fs.mkdir(quarantineDirectory, { recursive: true });
    let quarantinedEntries = 0;
    for (const item of report.corruptEntries) {
      const source = path.join(entriesDirectory, item.fileName);
      if (!(await fileExists(source))) continue;
      await fs.rename(source, path.join(quarantineDirectory, item.fileName));
      quarantinedEntries += 1;
    }

    const affectedFiles = new Set([...report.missingMedia, ...report.unsafeMedia].map((item) => item.fileName));
    let repairedEntries = 0;
    for (const fileName of affectedFiles) {
      const filePath = path.join(entriesDirectory, fileName);
      const entry = await readJson(filePath);
      if (!entry) continue;
      entry.media = (Array.isArray(entry.media) ? entry.media : []).map((media) => {
        const issue = [...report.missingMedia, ...report.unsafeMedia]
          .some((item) => item.fileName === fileName && item.localPath === String(media?.localPath || ""));
        if (!issue) return media;
        const repaired = { ...media, localPath: null, size: 0, downloadError: "本地媒体缺失，等待下次备份重新下载" };
        return repaired;
      });
      entry.contentFingerprint = entryContentFingerprint(entry);
      await atomicWriteJson(filePath, entry);
      repairedEntries += 1;
    }

    const counts = await this.summarize();
    const manifest = await readJson(this.manifestPath);
    if (manifest) {
      manifest.updatedAt = isoNow();
      manifest.collection = {
        ...manifest.collection,
        counts,
        highWater: { posts: await this.buildPostsHighWater() },
      };
      await atomicWriteJson(this.manifestPath, manifest);
    }
    await this.writeDiagnostic("integrity-repair", {
      repairId,
      quarantinedEntries,
      repairedEntries,
      missingMedia: report.missingMedia.length,
      unsafeMedia: report.unsafeMedia.length,
    });
    return {
      ...report,
      needsRepair: false,
      repairedEntries,
      quarantinedEntries,
      counts,
    };
  }

  async buildPostsHighWater() {
    const entries = (await this.readEntries())
      .filter((entry) => entry.type === "post" && entry.sourceId)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return {
      latestCreatedAt: entries[0]?.createdAt || null,
      recentSourceIds: entries.slice(0, 200).map((entry) => String(entry.sourceId)),
      capturedAt: isoNow(),
    };
  }

  async writeCheckpoint(checkpoint) {
    await atomicWriteJson(path.join(this.rootPath, "state", "checkpoint.json"), {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      ...checkpoint,
      updatedAt: isoNow(),
    });
  }

  async writeDiagnostic(name, diagnostic) {
    const safeName = String(name || "diagnostic").replace(/[^a-z0-9._-]/gi, "-");
    await atomicWriteJson(path.join(this.rootPath, "diagnostics", `${safeName}.json`), {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      ...diagnostic,
      recordedAt: isoNow(),
    });
  }

  async complete({ jobId, status = "ready_for_collection", counts, changes, fullScanCompleted = true, cursors = {} }) {
    const manifest = await readJson(this.manifestPath);
    if (!manifest) throw new Error("归档清单不存在");
    const completedAt = isoNow();
    manifest.updatedAt = completedAt;
    const normalizedChanges = {
      added: Math.max(0, Number(changes?.added) || 0),
      updated: Math.max(0, Number(changes?.updated) || 0),
      skipped: Math.max(0, Number(changes?.skipped) || 0),
    };
    manifest.collection = {
      ...manifest.collection,
      status,
      activeJobId: null,
      lastCompletedJobId: jobId,
      lastCompletedAt: completedAt,
      counts: counts || manifest.collection.counts,
      highWater: { posts: await this.buildPostsHighWater() },
      lastFullScanAt: fullScanCompleted ? completedAt : manifest.collection.lastFullScanAt || null,
      lastRun: {
        mode: fullScanCompleted ? "full" : "incremental",
        changes: normalizedChanges,
        completedAt,
      },
      deletionPolicy: "retain_unseen",
    };
    await atomicWriteJson(this.manifestPath, manifest);
    await this.writeCheckpoint({ jobId, phase: status, cursors, counts: counts || manifest.collection.counts });
    return manifest;
  }
}

module.exports = { ArchiveStore, atomicWriteJson, entryFileName, readJson };
