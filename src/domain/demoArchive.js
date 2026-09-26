import { demoArchive } from "../mockArchive.js";

function loadSavedArchive() {
  try {
    if (window.localStorage.getItem("qzone-journal-demo-loaded") !== "true") return null;
    const lastBackupAt = window.localStorage.getItem("qzone-journal-demo-imported-at") || new Date().toISOString();
    return { ...demoArchive, lastBackupAt };
  } catch {
    return null;
  }
}

function rememberDemoArchive(archive) {
  try {
    window.localStorage.setItem("qzone-journal-demo-loaded", "true");
    window.localStorage.setItem("qzone-journal-demo-imported-at", archive.lastBackupAt);
  } catch {
    // The in-memory archive still works when local storage is unavailable.
  }
}

export { loadSavedArchive, rememberDemoArchive };
