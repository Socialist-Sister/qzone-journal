const { ipcMain } = require("electron");
const { requestChatCompletion, parseReview } = require("../ai/client.cjs");
const { normalizeBaseUrl, readAiConfig, normalizeModels, normalizeStoredConfig, publicAiConfig, decryptApiKey, resolveAiConfig, saveAiConfig, providerFromDraft } = require("../ai/config.cjs");
const { AI_SCOPE_PROMPT, compactArchive } = require("../ai/context.cjs");
const { readLatestArchive } = require("../services/archives.cjs");

function registerAiIpc() {
  ipcMain.handle("desktop:ai:get-config", async () => publicAiConfig(await readAiConfig()));

  ipcMain.handle("desktop:ai:add-provider", async (_event, draft) => {
    const stored = normalizeStoredConfig(await readAiConfig());
    stored.providers.push(providerFromDraft(draft));
    await saveAiConfig(stored);
    return publicAiConfig(stored);
  });

  ipcMain.handle("desktop:ai:update-provider", async (_event, draft) => {
    const stored = normalizeStoredConfig(await readAiConfig());
    const index = stored.providers.findIndex((provider) => provider.id === draft?.id);
    if (index < 0) throw new Error("没有找到要修改的模型服务");
    stored.providers[index] = providerFromDraft(draft, stored.providers[index]);
    await saveAiConfig(stored);
    return publicAiConfig(stored);
  });

  ipcMain.handle("desktop:ai:delete-provider", async (_event, providerId) => {
    const stored = normalizeStoredConfig(await readAiConfig());
    const nextProviders = stored.providers.filter((provider) => provider.id !== providerId);
    if (nextProviders.length === stored.providers.length) throw new Error("没有找到要删除的模型服务");
    stored.providers = nextProviders;
    await saveAiConfig(stored);
    return publicAiConfig(stored);
  });

  ipcMain.handle("desktop:ai:detect-models", async (_event, { providerId, draft = {} } = {}) => {
    const stored = normalizeStoredConfig(await readAiConfig());
    const provider = stored.providers.find((item) => item.id === providerId);
    const apiKey = String(draft.apiKey || "").trim() || decryptApiKey(provider);
    const baseUrl = normalizeBaseUrl(draft.baseUrl || provider?.baseUrl);
    if (!apiKey) throw new Error("请先填写 API Key");
    const response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error?.message || payload?.message || `模型列表读取失败（HTTP ${response.status}）`));
    const models = normalizeModels(payload?.data?.map((item) => item?.id)).sort((a, b) => a.localeCompare(b));
    if (!models.length) throw new Error("服务没有返回可选择的模型名称");
    return { models };
  });

  ipcMain.handle("desktop:ai:test-connection", async (_event, { selection = {}, draft = {} } = {}) => {
    const config = await resolveAiConfig(selection, draft);
    const reply = await requestChatCompletion(config, [
      { role: "system", content: "你是连接测试助手。只回复 OK。" },
      { role: "user", content: "请确认连接。" },
    ], { maxTokens: 128, temperature: 0 });
    return { ok: true, message: reply.slice(0, 40) };
  });

  ipcMain.handle("desktop:ai:generate-review", async (_event, { archive, selection } = {}) => {
    const config = await resolveAiConfig(selection);
    const sourceArchive = archive?.isDemo ? archive : await readLatestArchive(undefined, { limit: 300 });
    const archivePayload = compactArchive(sourceArchive);
    if (!archivePayload.entries.length) throw new Error("当前档案没有可供总结的内容");
    const content = await requestChatCompletion(config, [
      { role: "system", content: `${AI_SCOPE_PROMPT}\n你正在生成一篇结构化年度回顾。必须只返回一个 JSON 对象，不要使用 Markdown；即使接口未启用 JSON 模式，也必须遵守。` },
      {
        role: "user",
        content: `请根据下列档案生成克制、具体的中文回顾。JSON 必须包含：headline（短标题）、summary（总述）、themes（3—5 项，每项含 name、note、count）、moments（3—5 项，每项含 year、text）。count 只能统计档案中有明确证据的条目数。\n示例结构：{"headline":"这一年的一句话","summary":"只依据档案的总述","themes":[{"name":"主题","note":"依据线索","count":2}],"moments":[{"year":"2025","text":"有日期依据的时刻"}]}\n\n<archive_data>\n${JSON.stringify(archivePayload)}\n</archive_data>`,
      },
    ], { json: true, maxTokens: 3200, temperature: 0.2 });
    return { review: parseReview(content), model: config.model, providerName: config.providerName, sourceCount: archivePayload.entries.length };
  });

  ipcMain.handle("desktop:ai:ask-archive", async (_event, { archive, question, context = [], selection } = {}) => {
    const config = await resolveAiConfig(selection);
    const sourceArchive = archive?.isDemo ? archive : await readLatestArchive(undefined, { limit: 300 });
    const archivePayload = compactArchive(sourceArchive);
    const cleanQuestion = String(question || "").trim().slice(0, 1200);
    if (!cleanQuestion) throw new Error("请输入要向档案询问的问题");
    const recentContext = Array.isArray(context) ? context.slice(-4).map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || "").slice(0, 1800),
    })) : [];
    const answer = await requestChatCompletion(config, [
      { role: "system", content: `${AI_SCOPE_PROMPT}
  你正在进行“向档案提问”，目标是给出有证据、能继续追查的回答，而不是泛泛评价。
  回答要求：
  1. 先直接回应问题，区分“档案明确显示”与“基于多条记录的谨慎归纳”。
  2. 有足够材料时列出 3—6 条彼此不同的依据，每条写成“日期｜档案线索｜它支持什么判断”；不要把近义内容凑成多条。
  3. 对“我是什么样的人”一类问题，至少从两个不同时间段或主题归纳稳定倾向，同时指出可能的反例或信息边界。
  4. 只在确有不足时说明局限，并具体说缺少哪类信息；不要使用套话式免责声明。
  5. 使用以下纯文本结构，不使用 Markdown 标题或加粗符号：
  结论：
  （2—4 句）
  档案依据：
  - 日期｜线索｜判断
  边界：
  （1—2 句）
  回答通常控制在 700—1200 个中文字符；简单检索问题可以更短。` },
      { role: "user", content: `<archive_data>\n${JSON.stringify(archivePayload)}\n</archive_data>` },
      ...recentContext,
      { role: "user", content: cleanQuestion },
    ], { maxTokens: 2400, temperature: 0.15 });
    return { answer, model: config.model, providerName: config.providerName };
  });
}

module.exports = { registerAiIpc };
