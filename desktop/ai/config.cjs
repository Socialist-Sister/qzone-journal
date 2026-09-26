const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function aiConfigPath() {
  return path.join(app.getPath("userData"), "ai-config.json");
}

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || "").trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("服务地址必须使用 HTTP 或 HTTPS");
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (parsed.protocol === "http:" && !localHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error("远程模型服务必须使用 HTTPS；HTTP 仅允许本机地址");
  }
  if (parsed.search || parsed.hash) throw new Error("服务地址不能包含查询参数或锚点");
  if (parsed.pathname.replace(/\/$/, "").endsWith("/chat/completions")) throw new Error("服务地址不要包含 /chat/completions");
  return parsed.toString().replace(/\/$/, "");
}

async function readAiConfig() {
  try {
    return JSON.parse(await fs.readFile(aiConfigPath(), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeModels(models) {
  return [...new Set((Array.isArray(models) ? models : []).map((model) => String(model || "").trim()).filter(Boolean))].slice(0, 100);
}

function normalizeStoredConfig(config) {
  if (!config) return { version: 2, providers: [] };
  if (Array.isArray(config.providers)) {
    return {
      version: 2,
      providers: config.providers.map((provider) => ({
        id: String(provider.id || randomUUID()),
        name: String(provider.name || "未命名服务").trim().slice(0, 60),
        baseUrl: String(provider.baseUrl || ""),
        encryptedKey: String(provider.encryptedKey || ""),
        keyTail: String(provider.keyTail || ""),
        models: normalizeModels(provider.models),
      })),
    };
  }
  if (config.baseUrl || config.encryptedKey || config.model) {
    return {
      version: 2,
      providers: [{
        id: "migrated-default",
        name: "默认模型服务",
        baseUrl: String(config.baseUrl || ""),
        encryptedKey: String(config.encryptedKey || ""),
        keyTail: String(config.keyTail || ""),
        models: normalizeModels([config.model]),
      }],
    };
  }
  return { version: 2, providers: [] };
}

function publicAiConfig(config) {
  const normalized = normalizeStoredConfig(config);
  const providers = normalized.providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    models: provider.models,
    maskedKey: provider.keyTail ? `•••• ${provider.keyTail}` : "已安全保存",
  }));
  const modelOptions = normalized.providers.flatMap((provider) => provider.encryptedKey && provider.baseUrl
    ? provider.models.map((model) => ({
        key: `${provider.id}::${model}`,
        providerId: provider.id,
        providerName: provider.name,
        model,
      }))
    : []);
  return { configured: modelOptions.length > 0, providers, modelOptions };
}

function decryptApiKey(config) {
  if (!config?.encryptedKey) return "";
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法解密已保存的 API Key");
  return safeStorage.decryptString(Buffer.from(config.encryptedKey, "base64"));
}

async function resolveAiConfig(selection = {}, draft = {}) {
  const stored = normalizeStoredConfig(await readAiConfig());
  const provider = stored.providers.find((item) => item.id === (selection.providerId || draft.id));
  if (!provider && !draft.baseUrl) throw new Error("没有找到所选模型服务，请返回设置重新选择");
  const apiKey = String(draft.apiKey || "").trim() || decryptApiKey(provider);
  const baseUrl = normalizeBaseUrl(draft.baseUrl || provider?.baseUrl);
  const model = String(selection.model || draft.model || provider?.models?.[0] || "").trim();
  if (!apiKey) throw new Error("请填写 API Key");
  if (!model) throw new Error("请填写模型名称");
  if (provider && !draft.baseUrl && !provider.models.includes(model)) throw new Error("所选模型不在该服务的已保存列表中");
  return { apiKey, baseUrl, model, providerId: provider?.id || draft.id || "draft", providerName: provider?.name || draft.name || "模型服务" };
}

async function saveAiConfig(config) {
  const target = aiConfigPath();
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
}

function providerFromDraft(draft, existing) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统不支持安全保存 API Key");
  const apiKey = String(draft?.apiKey || "").trim() || decryptApiKey(existing);
  const name = String(draft?.name || "").trim().slice(0, 60);
  const baseUrl = normalizeBaseUrl(draft?.baseUrl);
  const models = normalizeModels(draft?.models);
  if (!name) throw new Error("请填写服务名称");
  if (!apiKey) throw new Error("请填写 API Key");
  return {
    id: existing?.id || randomUUID(),
    name,
    baseUrl,
    models,
    encryptedKey: safeStorage.encryptString(apiKey).toString("base64"),
    keyTail: apiKey.slice(-4),
  };
}

module.exports = { aiConfigPath, normalizeBaseUrl, readAiConfig, normalizeModels, normalizeStoredConfig, publicAiConfig, decryptApiKey, resolveAiConfig, saveAiConfig, providerFromDraft };
