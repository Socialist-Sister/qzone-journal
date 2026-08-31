const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, session } = require("electron");

async function run() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "qzone-journal-session-"));
  app.setPath("userData", userData);
  await app.whenReady();

  const persistentPartition = "persist:qzone-journal-account";
  const persistentSession = session.fromPartition(persistentPartition, { cache: false });
  await persistentSession.cookies.set({
    url: "https://user.qzone.qq.com/",
    name: "p_skey",
    value: "legacy-secret",
    path: "/",
    secure: true,
  });
  await fs.writeFile(path.join(userData, "qzone-accounts.json"), JSON.stringify({
    version: 1,
    activeAccountId: "legacy",
    accounts: [{
      id: "legacy",
      partition: persistentPartition,
      accountLabel: "QQ ••••5678",
      createdAt: "2026-08-29T00:00:00.000Z",
      lastUsedAt: "2026-08-29T00:00:00.000Z",
    }],
  }), "utf8");

  const qzone = require("../desktop/qzone-session.cjs");
  const accounts = await qzone.listQzoneAccounts();
  assert.equal(qzone.QZONE_PARTITION.startsWith("persist:"), false);
  assert.equal(accounts.accounts[0].accountLabel, "QQ ••••5678");
  assert.equal((await persistentSession.cookies.get({})).length, 0);
  assert.deepEqual(
    qzone.parseQzonePortraitResponse('portraitCallBack({"12345678":["","","","","","","林屿"]});', "12345678"),
    { uin: "12345678", nickname: "林屿", avatarUrl: "https://q.qlogo.cn/headimg_dl?dst_uin=12345678&spec=100" },
  );
  const updatedProfile = await qzone.updateQzoneAccountProfile("legacy", { uin: "12345678", nickname: "林屿" });
  assert.equal(updatedProfile.nickname, "林屿");
  assert.equal(updatedProfile.uin, "12345678");

  const runtimeSession = qzone.getQzoneSession();
  await runtimeSession.cookies.set({
    url: "https://user.qzone.qq.com/",
    name: "p_uin",
    value: "o12345678",
    path: "/",
    secure: true,
  });
  await runtimeSession.cookies.set({
    url: "https://user.qzone.qq.com/",
    name: "p_skey",
    value: "runtime-secret",
    path: "/",
    secure: true,
  });
  assert.equal((await runtimeSession.cookies.get({ name: "p_skey" })).length, 1);
  const publicStatus = qzone.publicSessionStatus(await qzone.inspectQzoneSession());
  assert.equal(publicStatus.uin, "12345678");
  assert.equal(publicStatus.nickname, "林屿");
  assert.match(publicStatus.avatarUrl, /dst_uin=12345678/);
  await qzone.clearQzoneCookies();
  assert.equal((await runtimeSession.cookies.get({})).length, 0);
  const retained = await qzone.listQzoneAccounts();
  assert.equal(retained.accounts[0].uin, "12345678");
  assert.equal(retained.accounts[0].nickname, "林屿");

  const deleted = await qzone.deleteQzoneAccount("legacy");
  assert.equal(deleted.accounts.length, 0);

  const storedRegistry = JSON.parse(await fs.readFile(path.join(userData, "qzone-accounts.json"), "utf8"));
  assert.equal(storedRegistry.version, 3);
  assert.equal(storedRegistry.accounts[0].partition.startsWith("persist:"), false);
  assert.equal(storedRegistry.accounts[0].accountLabel, "QQ 账号");
  process.stdout.write(`QZone temporary session smoke passed: ${userData}\n`);
}

run()
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
