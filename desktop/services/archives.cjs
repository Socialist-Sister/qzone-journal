const { app, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { ArchiveStore } = require("../archive/store.cjs");
const { deleteQzoneAccount, getActiveQzoneAccountId, listQzoneAccounts, qzoneAvatarUrl, updateQzoneAccountProfile } = require("../qzone-session.cjs");
const { toRendererArchiveEntry } = require("../archive/renderer-entry.cjs");
const { readAppPreferences } = require("./preferences.cjs");

async function defaultArchiveRoot(ownerUin) {
  const safeId = createHash("sha256").update(`qzone:${ownerUin}`).digest("hex").slice(0, 8);
  const { backupDirectory } = await readAppPreferences();
  return path.join(backupDirectory, `QQ-${String(ownerUin).slice(-4)}-${safeId}`);
}

function archiveIndexPath() {
  return path.join(app.getPath("userData"), "archive-index.json");
}

async function readArchiveIndex() {
  try {
    const stored = JSON.parse(await fs.readFile(archiveIndexPath(), "utf8"));
    if (stored?.version === 2 && stored.byAccount && typeof stored.byAccount === "object") return stored;
    if (stored?.archiveRoot) {
      return {
        version: 2,
        byAccount: {
          legacy: {
            archiveRoot: stored.archiveRoot,
            accountLabel: stored.accountLabel || "QQ 空间",
            updatedAt: stored.updatedAt || new Date().toISOString(),
          },
        },
      };
    }
    return { version: 2, byAccount: {} };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 2, byAccount: {} };
    throw error;
  }
}

async function writeArchiveIndex(index) {
  const target = archiveIndexPath();
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
}

async function rememberLatestArchive(archiveRoot, profile, accountId) {
  const index = await readArchiveIndex();
  const uin = /^\d{5,15}$/.test(String(profile?.uin || "")) ? String(profile.uin) : "";
  const nickname = String(profile?.nickname || "").trim().slice(0, 80);
  index.byAccount[String(accountId || "legacy")] = {
    archiveRoot,
    uin,
    nickname,
    avatarUrl: qzoneAvatarUrl(uin),
    accountLabel: nickname || (uin ? `QQ ${uin}` : profile?.accountLabel || "QQ 空间"),
    updatedAt: new Date().toISOString(),
  };
  await writeArchiveIndex(index);
}

async function assertArchiveRoot(archiveRoot) {
  const { knownBackupDirectories } = await readAppPreferences();
  const resolved = path.resolve(String(archiveRoot || ""));
  const allowed = knownBackupDirectories.some((directory) => {
    const allowedRoot = path.resolve(directory);
    return resolved === allowedRoot || resolved.startsWith(`${allowedRoot}${path.sep}`);
  });
  if (!allowed) throw new Error("归档路径不在已授权的本地目录中");
  return resolved;
}

async function assertDeletableArchiveRoot(archiveRoot) {
  const resolved = await assertArchiveRoot(archiveRoot);
  const { knownBackupDirectories } = await readAppPreferences();
  if (knownBackupDirectories.some((directory) => path.resolve(directory) === resolved)) {
    throw new Error("安全检查未通过：不能删除备份根目录");
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(resolved, "manifest.json"), "utf8"));
  } catch {
    throw new Error("安全检查未通过：目标不是可识别的空间备份档案");
  }
  if (manifest?.source?.platform !== "qzone" || !manifest?.archiveId) {
    throw new Error("安全检查未通过：目标缺少有效的 QQ 空间归档标识");
  }
  return resolved;
}

async function readArchiveIdentity(archiveRoot, suppliedEntries) {
  let manifest = null;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(archiveRoot, "manifest.json"), "utf8"));
  } catch {
    return { uin: "", nickname: "", avatarUrl: "" };
  }
  const ownerCandidate = String(manifest?.source?.ownerUin || "").replace(/\D/g, "");
  const uin = /^\d{5,15}$/.test(ownerCandidate) ? ownerCandidate : "";
  let entries = Array.isArray(suppliedEntries) ? suppliedEntries : null;
  if (!entries) {
    try {
      entries = (await new ArchiveStore(archiveRoot).readEntriesPage({ limit: 50 })).entries;
    } catch {
      entries = [];
    }
  }
  const nickname = String(entries.find((entry) => String(entry?.sourceMeta?.authorNickname || "").trim())?.sourceMeta?.authorNickname || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return { uin, nickname, avatarUrl: qzoneAvatarUrl(uin) };
}

async function readLatestArchive(accountId, pageOptions = {}) {
  const index = await readArchiveIndex();
  const activeAccountId = String(accountId || await getActiveQzoneAccountId());
  const accountIndex = index.byAccount[activeAccountId];
  if (!accountIndex) return null;
  const archiveRoot = await assertArchiveRoot(accountIndex.archiveRoot);
  const archiveStore = new ArchiveStore(archiveRoot);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(archiveRoot, "manifest.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const archivePage = await archiveStore.readEntriesPage({
    cursor: pageOptions?.cursor,
    limit: pageOptions?.limit,
    query: pageOptions?.query,
    type: pageOptions?.type,
  });
  const archiveIdentity = await readArchiveIdentity(archiveRoot, archivePage.entries);
  const accountProfile = await updateQzoneAccountProfile(activeAccountId, {
    uin: archiveIdentity.uin || accountIndex.uin,
    nickname: archiveIdentity.nickname || accountIndex.nickname,
  }).catch(() => ({
    uin: archiveIdentity.uin || String(accountIndex.uin || ""),
    nickname: archiveIdentity.nickname || String(accountIndex.nickname || ""),
    avatarUrl: archiveIdentity.avatarUrl || String(accountIndex.avatarUrl || ""),
    accountLabel: String(accountIndex.accountLabel || "QQ 空间"),
  }));
  const entries = archivePage.entries.map((entry) => toRendererArchiveEntry(entry, archiveRoot));
  const completedAt = manifest.collection?.lastCompletedAt;
  const imported = completedAt && Number.isFinite(Date.parse(completedAt)) ? new Date(completedAt) : null;
  return {
    id: String(manifest.archiveId || "local-qzone-archive"),
    isDemo: false,
    ownerUin: accountProfile.uin,
    ownerNickname: accountProfile.nickname,
    avatarUrl: accountProfile.avatarUrl,
    profileName: `${accountProfile.nickname || (accountProfile.uin ? `QQ ${accountProfile.uin}` : accountProfile.accountLabel || "QQ 空间")}的空间`,
    lastBackupAt: imported?.toISOString() || null,
    importedAt: imported ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeStyle: "short" }).format(imported) : "尚未完成备份",
    range: archivePage.range ? `${archivePage.range.firstYear}—${archivePage.range.lastYear}` : "尚无内容",
    integrity: { needsRepair: false, unchecked: true },
    stats: archivePage.stats,
    page: archivePage.page,
    entries,
  };
}

async function repairLatestArchive(accountId) {
  const index = await readArchiveIndex();
  const activeAccountId = String(accountId || await getActiveQzoneAccountId());
  const accountIndex = index.byAccount[activeAccountId];
  if (!accountIndex) throw new Error("当前账号还没有本地档案");
  const archiveRoot = await assertArchiveRoot(accountIndex.archiveRoot);
  return new ArchiveStore(archiveRoot).repairIntegrity();
}

async function listAccountsWithArchives() {
  const state = await listQzoneAccounts();
  const index = await readArchiveIndex();
  const accounts = await Promise.all(state.accounts.map(async (account) => {
    const archive = index.byAccount[account.id];
    let identity = { uin: "", nickname: "", avatarUrl: "" };
    if (archive?.archiveRoot) {
      try {
        identity = await readArchiveIdentity(await assertArchiveRoot(archive.archiveRoot));
      } catch {
        // Keep the stored profile when an archive is temporarily unavailable.
      }
    }
    const profile = await updateQzoneAccountProfile(account.id, {
      uin: account.uin || archive?.uin || identity.uin,
      nickname: account.nickname || archive?.nickname || identity.nickname,
    }).catch(() => account);
    return {
      ...account,
      ...profile,
      hasArchive: Boolean(archive?.archiveRoot),
      archivePath: archive?.archiveRoot ? String(archive.archiveRoot) : "",
    };
  }));
  return {
    activeAccountId: state.activeAccountId,
    accounts,
  };
}

async function deleteAccountData(accountId) {
  const id = String(accountId || "");
  const state = await listQzoneAccounts();
  const account = state.accounts.find((item) => item.id === id);
  if (!account) throw new Error("没有找到要删除的账号");
  const index = await readArchiveIndex();
  const archive = index.byAccount[id];
  let movedToTrash = false;
  if (archive?.archiveRoot) {
    const archiveRoot = await assertArchiveRoot(archive.archiveRoot);
    let archiveExists = true;
    try {
      await fs.access(archiveRoot);
    } catch (error) {
      if (error?.code === "ENOENT") archiveExists = false;
      else throw new Error(`无法读取本地档案：${error?.message || error}`);
    }
    if (archiveExists) {
      const deletableRoot = await assertDeletableArchiveRoot(archiveRoot);
      const sharedReference = Object.entries(index.byAccount)
        .some(([otherId, item]) => otherId !== id && path.resolve(String(item?.archiveRoot || "")) === deletableRoot);
      if (sharedReference) throw new Error("这个档案同时关联了其他账号，已停止删除");
      try {
        await shell.trashItem(deletableRoot);
        movedToTrash = true;
      } catch (error) {
        throw new Error(`无法将本地档案移入回收站：${error?.message || error}`);
      }
    }
    delete index.byAccount[id];
    await writeArchiveIndex(index);
  }
  await deleteQzoneAccount(id);
  return {
    ...(await listAccountsWithArchives()),
    deletedAccountLabel: account.accountLabel,
    movedToTrash,
  };
}

module.exports = { defaultArchiveRoot, archiveIndexPath, readArchiveIndex, writeArchiveIndex, rememberLatestArchive, assertArchiveRoot, assertDeletableArchiveRoot, readArchiveIdentity, readLatestArchive, repairLatestArchive, listAccountsWithArchives, deleteAccountData };
