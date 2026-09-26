import { useEffect, useState } from "react";
import { ArrowsClockwise, CheckCircle, ClockCounterClockwise, Code, FolderOpen, FileArrowDown, HardDrive, Info, Key, LockKey, PencilSimple, Plus, Robot, ShieldCheck, SlidersHorizontal, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { LoadingSpinner } from "../../components/LoadingSpinner.jsx";
import { BrandMark } from "../../components/TitleBar.jsx";
import { readableError, openProjectPage } from "../../lib/presentation.js";
import { readExportAnonymizePreference, writeExportAnonymizePreference } from "../archive/ArchiveExportDialog.jsx";

function SettingsView({ section, onSectionChange, aiConfig, onAiConfigChange, archive, onRepairArchive, archiveRepairing }) {
  const [autoBackup, setAutoBackup] = useState(false);
  const [anonymous, setAnonymous] = useState(readExportAnonymizePreference);
  const [notice, setNotice] = useState("");
  const [backupDirectory, setBackupDirectory] = useState("文档/空间备份");
  const [appVersion, setAppVersion] = useState("0.7.0-alpha");
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);
  const [providerEditor, setProviderEditor] = useState(null);
  const [manualModel, setManualModel] = useState("");
  const [detectedModels, setDetectedModels] = useState([]);
  const [selectedDetectedModels, setSelectedDetectedModels] = useState([]);
  const [savingAi, setSavingAi] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testingModelProgress, setTestingModelProgress] = useState({ current: 0, total: 0 });
  const [modelTestResults, setModelTestResults] = useState([]);
  const [detectingModels, setDetectingModels] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);

  useEffect(() => {
    if (!window.desktop?.app?.getInfo) return;
    window.desktop.app.getInfo().then((info) => setAppVersion(info.version)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!window.desktop?.dialogs?.getBackupDirectory) return;
    window.desktop.dialogs.getBackupDirectory().then(setBackupDirectory).catch(() => undefined);
  }, []);

  const settingsSections = [
    { id: "general", label: "常规", icon: SlidersHorizontal },
    { id: "ai", label: "AI 接入", icon: Robot },
    { id: "privacy", label: "隐私与导出", icon: ShieldCheck },
    { id: "about", label: "关于", icon: Info },
  ];

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const chooseBackupDirectory = async () => {
    if (!window.desktop?.dialogs?.selectBackupDirectory) {
      showNotice("桌面版将在这里打开系统目录选择器");
      return;
    }
    try {
      const selectedPath = await window.desktop.dialogs.selectBackupDirectory();
      if (selectedPath) {
        setBackupDirectory(selectedPath);
        showNotice("保存位置已更新，后续备份将写入新目录");
      }
    } catch (error) {
      showNotice(readableError(error));
    }
  };

  const openBackupDirectory = async () => {
    if (!window.desktop?.dialogs?.openBackupDirectory) {
      showNotice("打开目录仅在桌面版中可用");
      return;
    }
    try {
      await window.desktop.dialogs.openBackupDirectory();
    } catch (error) {
      showNotice(readableError(error));
    }
  };

  const exportDiagnostics = async () => {
    if (exportingDiagnostics) return;
    if (!window.desktop?.app?.exportDiagnostics) {
      showNotice("脱敏诊断导出仅在桌面版中可用");
      return;
    }
    setExportingDiagnostics(true);
    try {
      const result = await window.desktop.app.exportDiagnostics();
      if (result?.exported) showNotice(`已导出 ${result.fileName}`);
    } catch (error) {
      showNotice(readableError(error));
    } finally {
      setExportingDiagnostics(false);
    }
  };

  const checkUpdates = async () => {
    if (!window.desktop?.app?.checkForUpdates) {
      showNotice("版本检查仅在桌面版中可用");
      return;
    }
    setCheckingUpdates(true);
    try {
      const result = await window.desktop.app.checkForUpdates();
      setUpdateResult(result);
      showNotice(result.updateAvailable ? `发现新版本 ${result.latestVersion}` : "当前已是最新版本");
    } catch (error) {
      showNotice(readableError(error));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const openLatestRelease = async () => {
    try {
      await window.desktop?.app?.openRelease?.(updateResult?.releaseUrl);
    } catch (error) {
      showNotice(readableError(error));
    }
  };

  const openProviderEditor = (provider = null) => {
    setProviderEditor(provider ? {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: "",
      models: [...provider.models],
      maskedKey: provider.maskedKey,
    } : { id: "", name: "", baseUrl: "", apiKey: "", models: [] });
    setManualModel("");
    setDetectedModels([]);
    setSelectedDetectedModels([]);
    setModelTestResults([]);
    setTestingModelProgress({ current: 0, total: 0 });
    setDeleteConfirmId("");
  };

  const closeProviderEditor = () => {
    setProviderEditor(null);
    setDetectedModels([]);
    setSelectedDetectedModels([]);
    setModelTestResults([]);
  };

  const updateProviderDraft = (field, value) => setProviderEditor((current) => ({ ...current, [field]: value }));

  const addManualModel = () => {
    const model = manualModel.trim();
    if (!model) return;
    setProviderEditor((current) => ({ ...current, models: [...new Set([...current.models, model])] }));
    setModelTestResults([]);
    setManualModel("");
  };

  const removeModel = (model) => {
    setProviderEditor((current) => ({ ...current, models: current.models.filter((item) => item !== model) }));
    setModelTestResults([]);
  };

  const mergeDetectedModels = () => {
    setProviderEditor((current) => ({ ...current, models: [...new Set([...current.models, ...selectedDetectedModels])] }));
    setSelectedDetectedModels([]);
    setModelTestResults([]);
  };

  const saveAiProvider = async () => {
    const method = providerEditor?.id ? "updateProvider" : "addProvider";
    if (!window.desktop?.ai?.[method]) {
      showNotice("请在桌面版中安全保存 AI 配置");
      return;
    }
    setSavingAi(true);
    try {
      const saved = await window.desktop.ai[method](providerEditor);
      onAiConfigChange(saved);
      closeProviderEditor();
      showNotice(providerEditor.id ? "模型服务已更新" : "模型服务已添加");
    } catch (error) {
      showNotice(readableError(error));
    } finally {
      setSavingAi(false);
    }
  };

  const testAiConnection = async () => {
    if (!window.desktop?.ai?.testConnection) {
      showNotice("连接测试仅在桌面版中可用");
      return;
    }
    const models = providerEditor?.models || [];
    if (!models.length) {
      showNotice("请先添加至少一个模型名称");
      return;
    }
    setTestingAi(true);
    setTestingModelProgress({ current: 0, total: models.length });
    setModelTestResults(models.map((model) => ({ model, status: "waiting", message: "等待测试" })));
    let passed = 0;
    try {
      for (let index = 0; index < models.length; index += 1) {
        const model = models[index];
        setTestingModelProgress({ current: index + 1, total: models.length });
        setModelTestResults((current) => current.map((item) => item.model === model ? { ...item, status: "testing", message: "正在连接" } : item));
        try {
          const result = await window.desktop.ai.testConnection({
            selection: { providerId: providerEditor.id, model },
            draft: { ...providerEditor, model },
          });
          passed += 1;
          setModelTestResults((current) => current.map((item) => item.model === model ? { ...item, status: "passed", message: result.message || "响应正常" } : item));
        } catch (error) {
          setModelTestResults((current) => current.map((item) => item.model === model ? { ...item, status: "failed", message: readableError(error) } : item));
        }
      }
      showNotice(passed === models.length ? `${passed} 个模型全部通过测试` : `${passed} 个通过，${models.length - passed} 个失败`);
    } finally {
      setTestingAi(false);
      setTestingModelProgress({ current: 0, total: models.length });
    }
  };

  const detectModels = async () => {
    if (!window.desktop?.ai?.detectModels) {
      showNotice("自动检测仅在桌面版中可用");
      return;
    }
    setDetectingModels(true);
    try {
      const result = await window.desktop.ai.detectModels({ providerId: providerEditor.id, draft: providerEditor });
      setDetectedModels(result.models);
      setSelectedDetectedModels(result.models.filter((model) => providerEditor.models.includes(model)));
      showNotice(`检测到 ${result.models.length} 个模型`);
    } catch (error) {
      showNotice(readableError(error));
    } finally {
      setDetectingModels(false);
    }
  };

  const deleteProvider = async (providerId) => {
    if (deleteConfirmId !== providerId) {
      setDeleteConfirmId(providerId);
      window.setTimeout(() => setDeleteConfirmId((current) => current === providerId ? "" : current), 3500);
      return;
    }
    if (!window.desktop?.ai?.deleteProvider) {
      showNotice("删除模型服务仅在桌面版中可用");
      return;
    }
    try {
      const updated = await window.desktop.ai.deleteProvider(providerId);
      onAiConfigChange(updated);
      if (providerEditor?.id === providerId) closeProviderEditor();
      setDeleteConfirmId("");
      showNotice("模型服务及其本机密钥已删除");
    } catch (error) {
      showNotice(readableError(error));
    }
  };

  return (
    <section className="utility-view settings-view">
      <div className="utility-heading">
        <span>偏好、隐私与应用信息</span>
        <h1>设置</h1>
        <p>管理本机备份方式，查看数据原则与项目信息。</p>
      </div>
      <div className="settings-layout">
        <nav className="settings-subnav" aria-label="设置分类">
          {settingsSections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={section === item.id ? "active" : ""}
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                type="button"
              >
                <Icon size={22} weight={section === item.id ? "fill" : "regular"} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {section === "general" && (
            <article className="settings-card">
              <h2>常规</h2>
              <div className="settings-list">
                <label>
                  <div><strong>自动提醒增量备份</strong><span>计划功能；当前 Alpha 不会在后台自动登录或提醒</span></div>
                  <input type="checkbox" checked={autoBackup} onChange={(event) => setAutoBackup(event.target.checked)} disabled />
                </label>
                <div className="settings-row settings-directory-row">
                  <div><strong>本地数据目录</strong><span>{backupDirectory}</span></div>
                  <div className="settings-directory-actions">
                    <button className="change-directory-action" type="button" onClick={chooseBackupDirectory}>更改位置</button>
                    <button className="open-directory-action" type="button" onClick={openBackupDirectory} aria-label="打开备份目录" title="打开备份目录"><FolderOpen size={22} /></button>
                  </div>
                </div>
                <div className="settings-row archive-maintenance-row">
                  <div>
                    <strong>本地档案完整性</strong>
                    <span>{!archive || archive.isDemo
                      ? "当前账号还没有可检查的本地档案"
                      : archive.integrity?.needsRepair
                        ? `已发现 ${archive.integrity.corruptEntries?.length || 0} 条损坏记录和 ${(archive.integrity.missingMedia?.length || 0) + (archive.integrity.unsafeMedia?.length || 0)} 个媒体文件问题`
                        : "检查记录格式和本地图片；只处理本地副本，不会修改 QQ 空间"}</span>
                  </div>
                  <button className="archive-maintenance-action" type="button" disabled={archiveRepairing || !archive || archive.isDemo} onClick={onRepairArchive}>
                    {archiveRepairing ? <><LoadingSpinner size={15} />正在检查…</> : "检查与修复"}
                  </button>
                </div>
              </div>
            </article>
          )}

          {section === "ai" && (
            <article className="settings-card ai-settings-card">
              <div className="ai-settings-heading">
                <div><h2>AI 接入</h2><p>可保存多个兼容服务与模型，生成回顾时再选择本次要调用的一项。</p></div>
                <button className="provider-add-action" type="button" onClick={() => openProviderEditor()}><Plus size={16} weight="bold" />添加服务</button>
              </div>

              <div className="provider-list" aria-label="已添加的模型服务">
                {(aiConfig?.providers || []).length === 0 ? (
                  <div className="provider-empty"><Robot size={24} weight="duotone" /><span><strong>还没有模型服务</strong><small>添加后可手动填写模型，也可从服务端自动检测。</small></span></div>
                ) : aiConfig.providers.map((provider) => (
                  <section className="provider-row" key={provider.id}>
                    <div className="provider-summary">
                      <span className="provider-status"><CheckCircle size={18} weight="fill" /></span>
                      <div><strong>{provider.name}</strong><small>{provider.baseUrl} · {provider.maskedKey}</small></div>
                    </div>
                    <div className="provider-models">
                      {provider.models.length ? provider.models.map((model) => <span key={model}>{model}</span>) : <em>尚未选择模型</em>}
                    </div>
                    <div className="provider-row-actions">
                      <button type="button" onClick={() => openProviderEditor(provider)}><PencilSimple size={15} />修改</button>
                      <button className={deleteConfirmId === provider.id ? "confirming" : ""} type="button" onClick={() => deleteProvider(provider.id)}><Trash size={15} />{deleteConfirmId === provider.id ? "再次点击确认" : "删除"}</button>
                    </div>
                  </section>
                ))}
              </div>

              {providerEditor && (
                <section className="provider-editor" aria-label={providerEditor.id ? "修改模型服务" : "添加模型服务"}>
                  <div className="provider-editor-heading"><div><strong>{providerEditor.id ? "修改模型服务" : "添加模型服务"}</strong><small>模型 ID 可手动添加，也可读取服务端列表后多选。</small></div><button type="button" onClick={closeProviderEditor} aria-label="关闭编辑" disabled={testingAi}><X size={18} /></button></div>
                  <div className="ai-field-list">
                    <label><span>服务名称</span><input type="text" value={providerEditor.name} onChange={(event) => updateProviderDraft("name", event.target.value)} placeholder="例如：OpenAI / DeepSeek / 本地模型" autoComplete="organization" /></label>
                    <label><span>服务地址</span><input type="url" value={providerEditor.baseUrl} onChange={(event) => updateProviderDraft("baseUrl", event.target.value)} placeholder="例如：https://api.openai.com/v1" autoComplete="url" /><small>填写兼容 Chat Completions 的 API 根地址，不包含 /chat/completions。</small></label>
                    <label><span>API Key</span><div className="ai-key-input"><Key size={18} /><input type="password" value={providerEditor.apiKey} onChange={(event) => updateProviderDraft("apiKey", event.target.value)} placeholder={providerEditor.maskedKey || "输入 API Key"} autoComplete="new-password" /></div><small>{providerEditor.id ? "留空将继续使用已安全保存的密钥。" : "仅由桌面端加密后保存在本机，不会写入档案。"}</small></label>
                    <div className="model-field">
                      <span>模型名称</span>
                      <div className="model-entry-row"><input type="text" value={manualModel} onChange={(event) => setManualModel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManualModel(); } }} placeholder="输入模型 ID 后添加" /><button type="button" onClick={addManualModel} disabled={testingAi || !manualModel.trim()}><Plus size={15} />添加</button><button type="button" onClick={detectModels} disabled={testingAi || detectingModels || !providerEditor.baseUrl.trim()}>{detectingModels ? <LoadingSpinner size={15} /> : <ArrowsClockwise size={15} />}自动检测</button></div>
                      <div className="selected-model-chips">{providerEditor.models.length ? providerEditor.models.map((model) => <button type="button" key={model} onClick={() => removeModel(model)} title="移除此模型" disabled={testingAi}><span>{model}</span><X size={13} /></button>) : <small>尚未添加模型；服务可以先保存，但 AI 回顾需至少选择一个模型。</small>}</div>
                    </div>
                  </div>

                  {detectedModels.length > 0 && (
                    <div className="detected-model-panel">
                      <div><strong>检测到的模型</strong><span>{selectedDetectedModels.length} / {detectedModels.length} 已选择</span></div>
                      <div className="detected-model-toolbar"><button type="button" onClick={() => setSelectedDetectedModels(detectedModels)}>全选</button><button type="button" onClick={() => setSelectedDetectedModels([])}>清空</button></div>
                      <div className="detected-model-list">{detectedModels.map((model) => { const checked = selectedDetectedModels.includes(model); return <label className={checked ? "selected" : ""} key={model}><input type="checkbox" checked={checked} onChange={() => setSelectedDetectedModels((current) => checked ? current.filter((item) => item !== model) : [...current, model])} /><span>{model}</span></label>; })}</div>
                      <button className="detected-merge-action" type="button" onClick={mergeDetectedModels} disabled={!selectedDetectedModels.length}>加入所选模型（{selectedDetectedModels.length}）</button>
                    </div>
                  )}

                  {modelTestResults.length > 0 && (
                    <div className="model-test-results" aria-live="polite">
                      <div><strong>模型测试结果</strong><span>{testingAi ? `正在测试 ${testingModelProgress.current}/${testingModelProgress.total}` : `${modelTestResults.filter((item) => item.status === "passed").length}/${modelTestResults.length} 通过`}</span></div>
                      <div>{modelTestResults.map((item) => (
                        <p className={item.status} key={item.model}>
                          {item.status === "passed" ? <CheckCircle size={16} weight="fill" /> : item.status === "failed" ? <WarningCircle size={16} weight="fill" /> : item.status === "testing" ? <LoadingSpinner size={16} /> : <ClockCounterClockwise size={16} />}
                          <span><strong>{item.model}</strong><small>{item.message}</small></span>
                        </p>
                      ))}</div>
                    </div>
                  )}

                  <div className="ai-settings-actions">
                    <button className="compact-action" type="button" onClick={saveAiProvider} disabled={testingAi || savingAi || !providerEditor.name.trim() || !providerEditor.baseUrl.trim()}>{savingAi ? <><LoadingSpinner size={16} />正在保存…</> : providerEditor.id ? "保存修改" : "添加服务"}</button>
                    <button className="outline-action" type="button" onClick={testAiConnection} disabled={testingAi || !providerEditor.baseUrl.trim() || !providerEditor.models.length}>{testingAi ? <><LoadingSpinner size={15} />正在测试 {testingModelProgress.current}/{testingModelProgress.total}</> : "测试模型"}</button>
                    <button className="editor-cancel-action" type="button" onClick={closeProviderEditor} disabled={testingAi}>取消</button>
                  </div>
                </section>
              )}

              <div className="ai-config-notes">
                <p><WarningCircle size={17} /><span><strong>可能产生费用</strong>保存配置本身不收费；“测试模型”会依次调用当前服务中已加入的每个模型，生成回顾和向档案提问也会产生调用，费用由模型服务商收取。</span></p>
                <p><LockKey size={17} /><span><strong>数据发送范围</strong>调用时会把相关档案文字与互动摘要发送给你配置的服务商，请先阅读其价格与隐私政策。</span></p>
              </div>
            </article>
          )}

          {section === "privacy" && (
            <article className="settings-card">
              <h2>隐私与导出</h2>
              <div className="settings-list">
                <label>
                  <div><strong>导出时默认匿名化好友</strong><span>隐藏互动昵称与正文中的好友提及，本人昵称保持不变。</span></div>
                  <input type="checkbox" checked={anonymous} onChange={(event) => { setAnonymous(event.target.checked); writeExportAnonymizePreference(event.target.checked); }} />
                </label>
                <div className="settings-row settings-directory-row">
                  <div><strong>脱敏诊断包</strong><span>导出应用、采集和档案状态，不包含 Cookie、完整 QQ 号、API Key、动态正文、人员信息、原始响应或本地绝对路径。</span></div>
                  <button className="archive-maintenance-action" type="button" disabled={exportingDiagnostics} onClick={exportDiagnostics}>
                    {exportingDiagnostics ? <><LoadingSpinner size={15} />正在导出…</> : <><FileArrowDown size={15} />导出诊断</>}
                  </button>
                </div>
              </div>
            </article>
          )}

          {section === "about" && (
            <div className="about-stack">
              <article className="settings-card about-product-card">
                <h2>关于</h2>
                <div className="about-product">
                  <BrandMark />
                  <div className="about-product-copy">
                    <strong>空间备份</strong>
                    <span>把自己的 QQ 空间整理成可长期保存的本地档案</span>
                    <small>当前版本：{appVersion}</small>
                  </div>
                  <div className="about-update-actions">
                    <button className="outline-action" type="button" onClick={checkUpdates} disabled={checkingUpdates}>{checkingUpdates ? <><LoadingSpinner size={15} />正在检查…</> : "检查更新"}</button>
                    {updateResult?.updateAvailable && <button className="text-action" type="button" onClick={openLatestRelease}>下载 {updateResult.latestVersion}</button>}
                  </div>
                </div>
                {updateResult && <p className="about-update-status" role="status">{updateResult.updateAvailable ? `有新版本可用${updateResult.checksumsAvailable ? "，发布页提供 SHA-256 校验值" : ""}。安装前请核对发布说明。` : "当前版本已经是 GitHub 上最新的公开版本。"}</p>}
              </article>

              <article className="settings-card">
                <h2>数据与隐私</h2>
                <div className="principle-list">
                  <div><HardDrive size={23} /><p><strong>档案默认只保存在你的电脑中</strong><span>只有主动生成 AI 回顾或向档案提问时，相关文字才会发送给你配置的模型服务商。</span></p></div>
                  <div><ShieldCheck size={23} /><p><strong>登录过程保持透明</strong><span>只打开 QQ 官方登录页面，不读取密码；采集结束后自动清除临时会话。</span></p></div>
                  <div><Code size={23} /><p><strong>本地优先，开源透明</strong><span>采集、整理与桌面端逻辑已公开，方便审查和自行构建。</span></p></div>
                </div>
              </article>

              <article className="settings-card about-license-card">
                <div><h2>开源与许可</h2><p>项目以 MIT License 开源；当前为早期 Alpha，请在使用前阅读仓库中的能力边界与免责声明。</p></div>
                <button className="outline-action" type="button" onClick={() => openProjectPage()}>查看项目说明</button>
              </article>
            </div>
          )}
        </div>
        {notice && <div className="settings-notice" role="status">{notice}</div>}
      </div>
    </section>
  );
}

export { SettingsView };
