

async function requestChatCompletion(config, messages, options = {}) {
  const endpoint = `${config.baseUrl}/chat/completions`;
  const prefersThinkingDisabled = /deepseek/i.test(config.model) || /deepseek/i.test(config.baseUrl);
  const readableContent = (content) => {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    }).join("").trim();
  };
  const run = async ({ withJsonMode, modernTokenField, minimal, disableThinking }) => {
    const body = { model: config.model, messages, stream: false };
    if (!minimal) {
      body.temperature = options.temperature ?? 0.2;
      body[modernTokenField ? "max_completion_tokens" : "max_tokens"] = options.maxTokens ?? 1200;
    }
    if (withJsonMode) body.response_format = { type: "json_object" };
    if (disableThinking) body.thinking = { type: "disabled" };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `请求失败（HTTP ${response.status}）`;
      const error = new Error(String(message));
      error.status = response.status;
      throw error;
    }
    const choice = payload?.choices?.[0];
    const content = readableContent(choice?.message?.content)
      || readableContent(choice?.text)
      || readableContent(payload?.output_text);
    if (!content) {
      const finishReason = choice?.finish_reason || "unknown";
      const emptyError = new Error(finishReason === "length"
        ? "模型在输出正文前已达到长度限制"
        : finishReason === "content_filter"
          ? "模型服务商拦截了本次输出"
          : `模型返回了空内容（结束原因：${finishReason}）`);
      emptyError.retryable = finishReason !== "content_filter";
      throw emptyError;
    }
    return content;
  };
  const attempts = options.json
    ? [
        { withJsonMode: true, modernTokenField: false, minimal: false, disableThinking: prefersThinkingDisabled },
        { withJsonMode: false, modernTokenField: false, minimal: false, disableThinking: prefersThinkingDisabled },
        { withJsonMode: false, modernTokenField: false, minimal: false, disableThinking: false },
        { withJsonMode: false, modernTokenField: true, minimal: false, disableThinking: false },
        { withJsonMode: false, modernTokenField: false, minimal: true, disableThinking: false },
      ]
    : [
        { withJsonMode: false, modernTokenField: false, minimal: false, disableThinking: prefersThinkingDisabled },
        { withJsonMode: false, modernTokenField: false, minimal: false, disableThinking: false },
        { withJsonMode: false, modernTokenField: true, minimal: false, disableThinking: false },
        { withJsonMode: false, modernTokenField: false, minimal: true, disableThinking: false },
      ];
  const uniqueAttempts = attempts.filter((attempt, index) => attempts.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(attempt)) === index);
  let lastError;
  let emptyResponseCount = 0;
  for (const attempt of uniqueAttempts) {
    try {
      return await run(attempt);
    } catch (error) {
      lastError = error;
      if (error.retryable) {
        emptyResponseCount += 1;
        if (emptyResponseCount >= 2) break;
        continue;
      }
      if (error.status !== 400) throw error;
    }
  }
  if (lastError?.retryable) throw new Error(`${lastError.message}。应用已自动切换普通文本与兼容参数重试，仍未取得正文；请稍后重试或换用文本对话模型。`);
  throw lastError;
}

function parseReview(content) {
  const unfenced = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const objectStart = unfenced.indexOf("{");
  const objectEnd = unfenced.lastIndexOf("}");
  const cleaned = objectStart >= 0 && objectEnd > objectStart ? unfenced.slice(objectStart, objectEnd + 1) : unfenced;
  const value = JSON.parse(cleaned);
  if (!value || typeof value.headline !== "string" || typeof value.summary !== "string") throw new Error("模型返回的回顾格式不完整");
  const themes = Array.isArray(value.themes) ? value.themes.slice(0, 5) : [];
  const moments = Array.isArray(value.moments) ? value.moments.slice(0, 5) : [];
  return {
    headline: value.headline.slice(0, 120),
    summary: value.summary.slice(0, 800),
    themes: themes.map((item) => ({ name: String(item.name || "未命名主题").slice(0, 30), note: String(item.note || "").slice(0, 160), count: Math.max(0, Number(item.count) || 0) })),
    moments: moments.map((item) => ({ year: String(item.year || "—").slice(0, 12), text: String(item.text || "").slice(0, 220) })),
  };
}

module.exports = { requestChatCompletion, parseReview };
