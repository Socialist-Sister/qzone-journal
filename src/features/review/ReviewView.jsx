import { useEffect, useState } from "react";
import { ArrowsClockwise, Info, Key, LockKey, PaperPlaneTilt, Robot, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { EmptyView } from "../../components/EmptyView.jsx";
import { LoadingSpinner } from "../../components/LoadingSpinner.jsx";
import { readableError } from "../../lib/presentation.js";
import { getDemoStats } from "../../mockArchive.js";
import { ArchiveAnswer } from "./ArchiveAnswer.jsx";
import { ModelPicker } from "./ModelPicker.jsx";

function ReviewView({ archive, aiConfig, onStart, onImportDemo, onOpenAiSettings }) {
  const [review, setReview] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState(0);
  const [generationError, setGenerationError] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const [archiveConversation, setArchiveConversation] = useState([]);
  const modelOptions = aiConfig?.modelOptions || [];
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const selectedModel = modelOptions.find((option) => option.key === selectedModelKey) || modelOptions[0];

  useEffect(() => {
    if (!modelOptions.some((option) => option.key === selectedModelKey)) setSelectedModelKey(modelOptions[0]?.key || "");
  }, [aiConfig, modelOptions, selectedModelKey]);

  useEffect(() => {
    setReview(null);
    setArchiveConversation([]);
    setGenerationError("");
  }, [archive]);

  useEffect(() => {
    if (!generating) {
      setGenerationPhase(0);
      return undefined;
    }
    const timers = [
      window.setTimeout(() => setGenerationPhase(1), 1500),
      window.setTimeout(() => setGenerationPhase(2), 4200),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [generating]);

  if (!archive) {
    return (
      <EmptyView
        icon={Sparkle}
        eyebrow="本地智能整理"
        title="AI 回顾"
        description="从自己的档案中发现主题、人物与特别时刻。"
        action="载入演示档案"
        onAction={onImportDemo}
        secondaryAction="创建第一份备份"
        onSecondaryAction={onStart}
        note="接入 AI 后才会生成回顾；模型服务可能产生费用。"
      />
    );
  }

  if (!aiConfig?.configured) {
    return (
      <section className="utility-view review-view">
        <div className="utility-heading">
          <span>本地智能整理</span>
          <h1>AI 回顾</h1>
          <p>接入你自己的模型服务后，才能根据档案生成回顾。</p>
        </div>
        <article className="ai-gate-card">
          <span className="ai-gate-icon"><Robot size={28} weight="fill" /></span>
          <div>
            <h2>尚未接入 AI</h2>
            <p>配置一个 OpenAI 兼容接口。API Key 将由桌面系统加密保存在本机。</p>
          </div>
          <button className="compact-action" type="button" onClick={onOpenAiSettings}>前往接入 AI</button>
          <small><WarningCircle size={14} />模型服务商可能按用量收费；生成前请确认其价格与隐私政策。</small>
        </article>
      </section>
    );
  }

  const stats = getDemoStats(archive);
  const selection = selectedModel ? { providerId: selectedModel.providerId, model: selectedModel.model } : null;
  const generationMessages = [
    "正在整理档案内容与互动摘要…",
    `正在调用 ${selectedModel?.model || "所选模型"}…`,
    "模型正在组织主题与时间线，请稍候…",
  ];
  const generateReview = async () => {
    if (!selection) {
      setGenerationError("请先选择要调用的模型。");
      return;
    }
    if (!window.desktop?.ai?.generateReview) {
      setGenerationError("请在桌面版中生成 AI 回顾，网页预览不会发送档案或 API Key。");
      return;
    }
    setGenerating(true);
    setGenerationError("");
    try {
      const result = await window.desktop.ai.generateReview({ archive, selection });
      setReview({ ...result.review, model: result.model, providerName: result.providerName, sourceCount: result.sourceCount });
      setArchiveConversation([]);
    } catch (error) {
      setGenerationError(readableError(error));
    } finally {
      setGenerating(false);
    }
  };

  const askArchive = async (event) => {
    event.preventDefault();
    const cleanQuestion = question.trim();
    if (!cleanQuestion || asking) return;
    if (!window.desktop?.ai?.askArchive) {
      setQuestionError("请在桌面版中向档案提问。");
      return;
    }
    setAsking(true);
    setQuestionError("");
    try {
      const context = archiveConversation.flatMap((item) => ([
        { role: "user", content: item.question },
        { role: "assistant", content: item.answer },
      ]));
      const result = await window.desktop.ai.askArchive({ archive, question: cleanQuestion, context, selection });
      setArchiveConversation((current) => [...current.slice(-3), { question: cleanQuestion, answer: result.answer }]);
      setQuestion("");
    } catch (error) {
      setQuestionError(readableError(error));
    } finally {
      setAsking(false);
    }
  };

  return (
    <section className="utility-view review-view">
      <div className="archive-heading-row">
        <div className="utility-heading">
          <span>本地智能整理</span>
          <h1>AI 回顾</h1>
          <p>本篇内容由人工智能模型生成，仅供回顾参考，不保证结论完整或准确。</p>
        </div>
        <div className="review-heading-tools">
          <ModelPicker options={modelOptions} value={selectedModel?.key || ""} onChange={setSelectedModelKey} disabled={generating || asking} />
          {review && (
            <div className="review-regenerate-control">
              <button className="review-regenerate-action" type="button" onClick={generateReview} disabled={generating}>
                {generating ? <><LoadingSpinner size={15} />重新生成中…</> : <><ArrowsClockwise size={15} />重新生成</>}
              </button>
            </div>
          )}
        </div>
      </div>

      {generating && (
        <div className="ai-generation-progress" role="status" aria-live="polite">
          <div><LoadingSpinner /><strong>{generationMessages[generationPhase]}</strong></div>
          <span className="ai-progress-track"><i /></span>
          <small>可以继续等待，界面不会卡住；生成时间取决于模型服务。</small>
        </div>
      )}
      {generationError && <p className="ai-inline-error review-global-error" role="alert">{generationError}</p>}

      {!review ? (
        <article className="ai-ready-card">
          <div className="ai-ready-copy">
            <span><Sparkle size={22} weight="fill" /></span>
            <div><h2>从 {stats.total} 条内容生成一篇回顾</h2><p>模型只会收到用于本次分析的档案文字与互动摘要，不会收到本地文件路径。</p></div>
          </div>
          <button className="compact-action" type="button" onClick={generateReview} disabled={generating}>
            {generating ? <><LoadingSpinner />正在生成…</> : "生成 AI 回顾"}
          </button>
          <small><WarningCircle size={14} />将把当前档案内容发送给你配置的模型服务商，并可能产生调用费用。</small>
        </article>
      ) : (
        <>
          <article className="review-lead">
            <Sparkle size={24} weight="fill" />
            <p>{review.headline}</p>
            <span>{review.summary}</span>
          </article>

          <div className="review-grid">
            <section className="review-paper-card">
              <h2>反复出现的主题</h2>
              <div className="theme-list">
                {review.themes.map((theme) => (
                  <div key={theme.name}>
                    <span><strong>{theme.name}</strong><small>{theme.note}</small></span>
                    <b>{theme.count}</b>
                  </div>
                ))}
              </div>
            </section>
            <section className="review-paper-card">
              <h2>时间里的转折</h2>
              <div className="moment-list">
                {review.moments.map((moment, index) => (
                  <div key={`${moment.year}-${index}`}><b>{moment.year}</b><span>{moment.text}</span></div>
                ))}
              </div>
            </section>
          </div>

          <section className="archive-question-card">
            <div className="archive-question-heading">
              <div><h2>向档案提问</h2><p>继续查找日期、人物和反复出现的线索；不回答档案以外的问题。</p></div>
              <span><LockKey size={15} />限定当前档案</span>
            </div>
            {archiveConversation.length > 0 && (
              <div className="archive-answer-list">
                {archiveConversation.map((item, index) => (
                  <article key={`${item.question}-${index}`}><strong>{item.question}</strong><ArchiveAnswer text={item.answer} /></article>
                ))}
              </div>
            )}
            <form className="archive-question-form" onSubmit={askArchive}>
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：我在哪些动态里提到过搬家？" rows={2} maxLength={1200} />
              <button type="submit" aria-label="向档案提问" disabled={asking || !question.trim()}>
                {asking ? <LoadingSpinner size={18} /> : <PaperPlaneTilt size={18} weight="fill" />}
              </button>
            </form>
            {questionError && <p className="ai-inline-error" role="alert">{questionError}</p>}
            <small>每次提问都会调用模型并可能产生费用；这里只保留最近 4 次问答。</small>
          </section>

          <div className="review-footnote"><Info size={16} />由 {review.providerName} · {review.model} 分析 {review.sourceCount} 条内容；结果可能存在遗漏或误判。</div>
        </>
      )}
    </section>
  );
}

export { ReviewView };
