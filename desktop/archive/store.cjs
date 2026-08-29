const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { ARCHIVE_SCHEMA_VERSION, createManifest, isoNow, normalizeArchiveEntry } = require("./schema.cjs");
const COLLECTOR_PARSER_VERSION = 3;

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
    const existing = await readJson(this.manifestPath);
    let existingCheckpoint = await readJson(path.join(this.rootPath, "state", "checkpoint.json"), {});
    const mediaIndexPath = path.join(this.rootPath, "media", "index.json");
    const existingMediaIndex = await readJson(mediaIndexPath, {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      items: {},
    });
    if (existing && existing.schemaVersion !== ARCHIVE_SCHEMA_VERSION) throw new Error(`暂不支持归档结构版本 ${existing.schemaVersion}`);
    const directories = ["records/entries", "records/people", "media/files", "state", "diagnostics"];
    await Promise.all(directories.map((directory) => fs.mkdir(path.join(this.rootPath, directory), { recursive: true })));
    let migratedEntries = 0;
    if (existing && Number(existing.collection?.parserVersion || 0) < COLLECTOR_PARSER_VERSION) {
      const entriesDirectory = path.join(this.rootPath, "records", "entries");
      const names = (await fs.readdir(entriesDirectory)).filter((name) => name.endsWith(".json"));
      if (names.length) {
        const fromVersion = Number(existing.collection?.parserVersion || 1);
        const quarantineDirectory = path.join(this.rootPath, "diagnostics", "migrations", `parser-v${fromVersion}-${Date.now()}`);
        await fs.mkdir(quarantineDirectory, { recursive: true });
        for (const name of names) await fs.rename(path.join(entriesDirectory, name), path.join(quarantineDirectory, name));
        migratedEntries = names.length;
      }
      existingCheckpoint = {};
    }
    const manifest = createManifest({ ownerUin, jobId, options, existing });
    manifest.collection.parserVersion = COLLECTOR_PARSER_VERSION;
    if (migratedEntries) manifest.collection.counts = { entries: 0, media: 0, mediaBytes: 0, comments: 0, likes: 0 };
    await atomicWriteJson(this.manifestPath, manifest);
    await atomicWriteJson(path.join(this.rootPath, "state", "checkpoint.json"), {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      jobId,
      phase: "initialized",
      cursors: existingCheckpoint?.phase === "collecting_posts" || existingCheckpoint?.phase === "cancelled" || existingCheckpoint?.phase === "failed"
        ? existingCheckpoint.cursors || {}
        : {},
      counts: existingCheckpoint?.counts || existing?.collection?.counts || {},
      updatedAt: isoNow(),
    });
    await atomicWriteJson(mediaIndexPath, existingMediaIndex);
    if (migratedEntries) {
      await atomicWriteJson(path.join(this.rootPath, "diagnostics", "parser-migration.json"), {
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        fromParserVersion: Number(existing.collection?.parserVersion || 1),
        toParserVersion: COLLECTOR_PARSER_VERSION,
        quarantinedEntries: migratedEntries,
        migratedAt: isoNow(),
      });
    }
    return manifest;
  }

  async writeEntry(input) {
    const entry = normalizeArchiveEntry(input);
    const filePath = path.join(this.rootPath, "records", "entries", entryFileName(entry));
    await atomicWriteJson(filePath, entry);
    return { entry, filePath };
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

  async complete({ jobId, status = "ready_for_collection", counts }) {
    const manifest = await readJson(this.manifestPath);
    if (!manifest) throw new Error("归档清单不存在");
    manifest.updatedAt = isoNow();
    manifest.collection = {
      ...manifest.collection,
      status,
      activeJobId: null,
      lastCompletedJobId: jobId,
      lastCompletedAt: isoNow(),
      counts: counts || manifest.collection.counts,
    };
    await atomicWriteJson(this.manifestPath, manifest);
    await this.writeCheckpoint({ jobId, phase: status, cursors: {} });
    return manifest;
  }
}

module.exports = { ArchiveStore, atomicWriteJson, entryFileName, readJson };
