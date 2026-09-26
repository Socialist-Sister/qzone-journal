const { app } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function appPreferencesPath() {
  return path.join(app.getPath("userData"), "app-preferences.json");
}

function defaultBackupDirectory() {
  return path.join(app.getPath("documents"), "空间备份");
}

function normalizeStoredDirectory(value, fallback = defaultBackupDirectory()) {
  const candidate = String(value || "").trim();
  if (!candidate || !path.isAbsolute(candidate)) return path.resolve(fallback);
  return path.resolve(candidate);
}

async function readAppPreferences() {
  let stored = null;
  try {
    stored = JSON.parse(await fs.readFile(appPreferencesPath(), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  const backupDirectory = normalizeStoredDirectory(stored?.backupDirectory);
  const knownBackupDirectories = [...new Set([
    defaultBackupDirectory(),
    backupDirectory,
    ...(Array.isArray(stored?.knownBackupDirectories) ? stored.knownBackupDirectories : []),
  ].map((value) => normalizeStoredDirectory(value)))].slice(-20);
  return { version: 1, backupDirectory, knownBackupDirectories };
}

async function saveAppPreferences(preferences) {
  const target = appPreferencesPath();
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
}

async function setBackupDirectory(directory) {
  const preferences = await readAppPreferences();
  const backupDirectory = normalizeStoredDirectory(directory, preferences.backupDirectory);
  const next = {
    version: 1,
    backupDirectory,
    knownBackupDirectories: [...new Set([...preferences.knownBackupDirectories, backupDirectory])].slice(-20),
  };
  await fs.mkdir(backupDirectory, { recursive: true });
  await saveAppPreferences(next);
  return backupDirectory;
}

module.exports = { appPreferencesPath, defaultBackupDirectory, normalizeStoredDirectory, readAppPreferences, saveAppPreferences, setBackupDirectory };
