import { TitleBar } from "./components/TitleBar.jsx";
import { ArchiveView } from "./features/archive/ArchiveView.jsx";
import { BackupDialog } from "./features/backup/BackupDialog.jsx";
import { DemoImportDialog } from "./features/backup/DemoImportDialog.jsx";
import { Home } from "./features/home/Home.jsx";
import { ReviewView } from "./features/review/ReviewView.jsx";
import { SettingsView } from "./features/settings/SettingsView.jsx";
import { useAppController } from "./hooks/useAppController.js";

function App() {
  const { activeView, setActiveView, settingsSection, setSettingsSection, dialogMethod, setDialogMethod, demoDialogOpen, setDemoDialogOpen, archiveData, aiConfig, setAiConfig, accountState, accountBusy, archiveRepairing, isMaximized, windowNotice, refreshAccounts, handleRepairArchive, handleSwitchAccount, handleAddAccount, handleDeleteAccount, start, complete, completeDemoImport, openAiSettings, handleWindowAction } = useAppController();
  return (
    <div className="app-shell">
      <TitleBar
        activeView={activeView}
        onNavigate={setActiveView}
        onWindowAction={handleWindowAction}
        isMaximized={isMaximized}
        accountState={accountState}
        accountBusy={accountBusy}
        onSwitchAccount={handleSwitchAccount}
        onAddAccount={handleAddAccount}
        onDeleteAccount={handleDeleteAccount}
      />
      <main className="app-main">
        <div className="looseleaf-rail" aria-hidden="true">
          <img src="./assets/looseleaf-edge.png" alt="" draggable={false} />
        </div>
        {activeView === "home" && <Home onStart={() => start("app")} archive={archiveData} />}
        {activeView === "archive" && <ArchiveView archive={archiveData} onStart={() => start("app")} onImportDemo={() => setDemoDialogOpen(true)} onReadPage={(options) => window.desktop?.qzone?.readArchive?.(options)} />}
        <div className="persistent-view" hidden={activeView !== "review"}>
          <ReviewView key={accountState.activeAccountId || "default"} archive={archiveData} aiConfig={aiConfig} onOpenAiSettings={openAiSettings} onStart={() => start("app")} onImportDemo={() => setDemoDialogOpen(true)} />
        </div>
        {activeView === "settings" && <SettingsView section={settingsSection} onSectionChange={setSettingsSection} aiConfig={aiConfig} onAiConfigChange={setAiConfig} archive={archiveData} onRepairArchive={handleRepairArchive} archiveRepairing={archiveRepairing} />}
      </main>
      {dialogMethod && <BackupDialog onClose={() => setDialogMethod(null)} onComplete={complete} onAccountChange={refreshAccounts} />}
      {demoDialogOpen && <DemoImportDialog onClose={() => setDemoDialogOpen(false)} onComplete={completeDemoImport} />}
      {windowNotice && <div className="window-notice" role="status">{windowNotice}</div>}
    </div>
  );
}

export { App };
