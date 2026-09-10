"use client";

import { useEffect, useRef, useState } from "react";
import { Brief, Job, prdApi } from "@/lib/prd-api";
import { fields } from "@/lib/use-prd-studio";
import { PanelHeading } from "@/components/workbench/workbench";
import s from "./studio.module.css";

interface Reply {
  answer: string;
  updates: Partial<Omit<Brief, "sources">>;
  reasoning_content: string;
  usage: { input_tokens: number; output_tokens: number };
}
interface Entry {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
}

export function PrdAssistant({
  brief,
  onBrief,
  content,
  model,
  configured,
  locked,
  showThinking,
  onThinking,
  job,
  onRevise,
  onNotice,
  focusToken,
  requestedMode,
  documentKey,
}: {
  brief: Brief;
  onBrief: (brief: Brief) => void;
  content: string;
  model: string;
  configured: boolean;
  locked: boolean;
  showThinking: boolean;
  onThinking: (value: boolean) => void;
  job: Job | null;
  onRevise: (instruction: string) => Promise<unknown>;
  onNotice: (text: string) => void;
  focusToken: number;
  requestedMode: "clarify" | "revise";
  documentKey: string;
}) {
  const [mode, setMode] = useState<"clarify" | "revise">("clarify");
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [proposal, setProposal] = useState<{
    result: Reply;
    before: Brief;
  } | null>(null);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  const previousKey = useRef(documentKey);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!focusToken) return;
    setMode(requestedMode);
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusToken, requestedMode]);
  const missing = fields.filter(
    (field) => field.key !== "template" && !brief[field.key].trim(),
  );
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(`studio-chat:${documentKey}`);
      if (cached) setEntries(JSON.parse(cached));
      else if (previousKey.current === "new" && documentKey !== "new") {
        const draft = sessionStorage.getItem("studio-chat:new");
        if (draft) {
          sessionStorage.setItem(`studio-chat:${documentKey}`, draft);
          sessionStorage.removeItem("studio-chat:new");
        }
      }
      previousKey.current = documentKey;
    } catch {
      /* A failed local cache must not block the assistant. */
    }
  }, [documentKey]);
  function updateEntries(next: Entry[]) {
    setEntries(next);
    try {
      sessionStorage.setItem(
        `studio-chat:${documentKey}`,
        JSON.stringify(next.slice(-40)),
      );
    } catch {
      onNotice("对话草稿无法保存到浏览器，可先复制重要内容。");
    }
  }
  async function send() {
    if (!text.trim() || locked || pendingRef.current) return;
    if (mode === "revise") {
      await onRevise(text.trim());
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError("");
    setProposal(null);
    const before = structuredClone(brief);
    const next: Entry[] = [...entries, { role: "user", text: text.trim() }];
    updateEntries(next);
    try {
      const result = await prdApi<Reply>("assistant", "POST", {
        brief,
        message: text,
        show_thinking: showThinking,
        history: entries.slice(-8).map((entry) => ({
          role: entry.role,
          content: entry.text.slice(0, 6000),
        })),
      });
      if (!mounted.current) return;
      updateEntries([
        ...next,
        {
          role: "assistant",
          text: result.answer,
          thinking: result.reasoning_content,
        },
      ]);
      setUsage(
        (value) =>
          value + result.usage.input_tokens + result.usage.output_tokens,
      );
      setProposal({ result, before });
      setText("");
    } catch (err) {
      if (mounted.current)
        setError(err instanceof Error ? err.message : "对话失败，请重试");
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  }
  function apply() {
    if (!proposal) return;
    const updates = proposal.result.updates;
    if (
      Object.keys(updates).some(
        (key) =>
          brief[key as keyof Brief] !== proposal.before[key as keyof Brief],
      )
    ) {
      setError("相关字段在对话期间已被编辑，请重新提问以免覆盖修改。");
      return;
    }
    onBrief({ ...brief, ...updates });
    setProposal(null);
    onNotice("建议已应用到简报，点击保存后进入文档库。");
  }
  return (
    <>
      <PanelHeading
        actions={
          <button
            className={s.iconButton}
            aria-label="清空对话"
            disabled={pending}
            onClick={() => {
              updateEntries([]);
              setProposal(null);
              setError("");
            }}
          >
            ＋
          </button>
        }
      >
        <span className={s.spark}>✧</span> Nexus Copilot
      </PanelHeading>
      <div className={s.context}>
        当前上下文 <span>▤ 需求简报</span>
        {content && <span># PRD</span>}
      </div>
      <div className={s.chatScroll}>
        <div className={s.assistantMessage}>
          <strong>✧ Nexus Copilot</strong>
          <p>
            从产品构想开始，逐步明确用户、范围与验收标准。你可以直接填写简报，也可以让我整理成建议。
          </p>
        </div>
        <section className={s.question}>
          <h3>
            {missing.length ? `首先，${missing[0].title}` : "需求信息已填写"}
          </h3>
          <p>
            {missing[0]?.hint ||
              "可以运行 PRD 工作流，或继续补充更具体的需求。"}
          </p>
          <small>{missing.length} 项待补充 · 未确认内容会在生成时标注</small>
        </section>
        {entries.map((entry, index) => (
          <div
            key={index}
            className={
              entry.role === "user" ? s.userMessage : s.assistantMessage
            }
          >
            <strong>{entry.role === "user" ? "我" : "✧ Nexus Copilot"}</strong>
            {showThinking && entry.thinking && (
              <details>
                <summary>思考过程</summary>
                <pre>{entry.thinking}</pre>
              </details>
            )}
            <p>{entry.text}</p>
          </div>
        ))}
        {proposal && Object.keys(proposal.result.updates).length > 0 && (
          <section className={s.proposal}>
            <h3>建议更新简报</h3>
            {Object.entries(proposal.result.updates).map(([key, value]) => (
              <div key={key}>
                <strong>
                  {fields.find((field) => field.key === key)?.title}
                </strong>
                <p>{value}</p>
              </div>
            ))}
            <button disabled={locked} onClick={apply}>
              应用建议
            </button>
            <button onClick={() => setProposal(null)}>忽略</button>
          </section>
        )}
        {pending && <p role="status">正在分析需求…</p>}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        {job?.stream && (
          <section className={s.stream}>
            <strong>{job.stream.title}</strong>
            <small>
              {job.stream.status === "streaming" ? "实时输出" : "阶段记录"}
            </small>
            {showThinking && job.show_thinking && (
              <details open>
                <summary>思考过程</summary>
                <pre>{job.stream.reasoning_content || "尚无思考内容"}</pre>
              </details>
            )}
            <pre>{job.stream.content || "等待模型输出…"}</pre>
          </section>
        )}
      </div>
      <div className={s.composerArea}>
        <div className={s.chatMode}>
          <button
            aria-pressed={mode === "clarify"}
            onClick={() => setMode("clarify")}
          >
            需求澄清
          </button>
          <button
            aria-pressed={mode === "revise"}
            disabled={!content}
            onClick={() => setMode("revise")}
          >
            修订正文
          </button>
        </div>
        <label className={s.thinkingSwitch}>
          <input
            type="checkbox"
            role="switch"
            checked={showThinking}
            onChange={(event) => onThinking(event.target.checked)}
          />
          显示思考过程
        </label>
        <form
          className={s.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={input}
            aria-label="与 AI 对话"
            value={text}
            maxLength={8000}
            disabled={locked || pending}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              mode === "clarify"
                ? "描述你的产品想法，或回答上面的问题…"
                : "说明要修改的内容和需要保留的要求…"
            }
            rows={3}
          />
          <div>
            <small>
              {pending ? "模型处理中" : configured ? model : "请先配置模型"}
              {usage > 0 && ` · 对话 ${usage} tokens`}
            </small>
            <button
              disabled={locked || pending || !text.trim() || !configured}
              aria-label={mode === "clarify" ? "发送需求" : "提交修订"}
            >
              ↑
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
