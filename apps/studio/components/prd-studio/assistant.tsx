"use client";

import { useEffect, useRef, useState } from "react";
import { Brief, Job, prdApi } from "@/lib/prd-api";
import { fields } from "@/lib/use-prd-studio";
import type { PrototypeSelection } from "@/lib/prototype";
import {
  PanelHeading,
  CloseAssistantButton,
} from "@/components/workbench/workbench";
import { AttachmentDropzone } from "@/components/workbench/attachment-dropzone";
import s from "./studio.module.css";

interface Reply {
  answer: string;
  updates: Partial<Omit<Brief, "sources" | "prototype">>;
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
  onPrototype,
  onNotice,
  focusToken,
  requestedMode,
  documentKey,
  onUpload,
  onUploadBusy,
  onOpenSources,
  onOpenDocument,
  prototypeSelection,
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
  onPrototype: (instruction: string) => Promise<unknown>;
  onRevise: (instruction: string) => Promise<unknown>;
  onNotice: (text: string) => void;
  focusToken: number;
  requestedMode: "clarify" | "revise" | "prototype";
  documentKey: string;
  onUpload: (files: File[]) => Promise<void>;
  onUploadBusy: (busy: boolean) => void;
  onOpenSources: () => void;
  onOpenDocument: () => void;
  prototypeSelection: PrototypeSelection | null;
}) {
  const [mode, setMode] = useState<"clarify" | "revise" | "prototype">(
    "clarify",
  );
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
  const chatEnd = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const images = brief.prototype?.pages.map((page) => [
    "",
    page.title,
    page.screenshot,
  ]) || [...content.matchAll(/!\[([^\]\n]*)\]\(([^\s)]+)\)/g)];
  useEffect(() => {
    if (followOutput.current)
      chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [entries, pending, proposal, job?.stream?.sequence]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setMode(requestedMode);
    if (!focusToken) return;
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
    if (mode === "revise" || mode === "prototype") {
      pendingRef.current = true;
      setPending(true);
      try {
        const selectionContext = prototypeSelection
          ? `当前只处理页面“${prototypeSelection.pageTitle}”中的选中组件。组件 ID：${prototypeSelection.block.props.id}；组件类型：${prototypeSelection.block.type}；当前属性：${JSON.stringify(prototypeSelection.block.props)}。保持其他页面和组件不变，并保留这个稳定组件 ID。`
          : "";
        const maximumText = Math.max(1, 8000 - selectionContext.length - 2);
        const instruction = selectionContext
          ? `${text.trim().slice(0, maximumText)}\n\n${selectionContext}`
          : text.trim();
        await (mode === "prototype"
          ? onPrototype(instruction)
          : onRevise(text.trim()));
      } finally {
        pendingRef.current = false;
        if (mounted.current) setPending(false);
      }
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
          <span style={{ display: "flex", gap: 4 }}>
            <button
              className={s.iconButton}
              aria-label="清空对话"
              title="新建对话（保留简报与附件）"
              disabled={pending}
              onClick={() => {
                updateEntries([]);
                setProposal(null);
                setError("");
              }}
            >
              ＋
            </button>
            <CloseAssistantButton className={s.iconButton} />
          </span>
        }
      >
        <span className={s.spark}>✧</span> Nexus Copilot
      </PanelHeading>
      <div
        className={s.chatScroll}
        onScroll={(event) => {
          const area = event.currentTarget;
          followOutput.current =
            area.scrollHeight - area.scrollTop - area.clientHeight < 80;
        }}
      >
        {mode === "prototype" && prototypeSelection && (
          <section className={s.componentContext} aria-label="当前原型组件上下文">
            <span>当前组件</span>
            <strong>{prototypeSelection.block.props.label || prototypeSelection.block.type}</strong>
            <code>{prototypeSelection.block.props.id}</code>
            <small>AI 请求将携带当前属性，并要求保留其他组件。</small>
          </section>
        )}
        {!entries.length && !job && (
          <section className={s.question}>
            <h3>
              {missing.length ? `首先，${missing[0].title}` : "需求信息已填写"}
            </h3>
            <p>
              {missing[0]?.hint ||
                "可以运行 PRD 工作流，或继续补充更具体的需求。"}
            </p>
            <small>也可以直接告诉我你的构想，一起完善需求。</small>
          </section>
        )}
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
        <div ref={chatEnd} />
      </div>
      <div className={s.composerArea}>
        <label className={s.thinkingSwitch}>
          <input
            type="checkbox"
            role="switch"
            checked={showThinking}
            onChange={(event) => onThinking(event.target.checked)}
          />
          显示思考过程
        </label>
        {(brief.sources.length > 0 || images.length > 0) && (
          <details className={s.chatAttachments} open>
            <summary>
              工作区附件 · {brief.sources.length + images.length}
            </summary>
            <div className={s.attachmentList}>
              {brief.sources.map((source, index) => (
                <div className={s.attachmentChip} key={`source-${index}`}>
                  <button
                    type="button"
                    title={`查看 ${source.name}`}
                    onClick={onOpenSources}
                  >
                    ▤ S{index + 1} · {source.name || "未命名材料"}
                  </button>
                  <button
                    type="button"
                    aria-label={`移除附件 ${source.name}`}
                    disabled={locked || pending}
                    onClick={() =>
                      onBrief({
                        ...brief,
                        sources: brief.sources.filter((_, i) => i !== index),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {images.map((match, index) => (
                <div className={s.attachmentChip} key={`image-${index}`}>
                  <button
                    type="button"
                    title="查看原型图；AI 根据交互说明编写需求"
                    onClick={onOpenDocument}
                  >
                    ▧ {match[1] || "文档配图"}
                  </button>
                  <small>原型</small>
                </div>
              ))}
            </div>
          </details>
        )}
        <AttachmentDropzone
          accept=".md,.markdown,.txt,image/png,image/jpeg,image/webp"
          disabled={locked || pending}
          onUpload={onUpload}
          onBusy={onUploadBusy}
        >
          {(open) => (
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
                  mode === "prototype"
                    ? "说明原型页面、布局或跳转的修改要求…"
                    : mode === "clarify"
                      ? "描述你的产品想法，或回答上面的问题…"
                      : "说明要修改的内容和需要保留的要求…"
                }
                rows={3}
                onKeyDown={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div>
                <button
                  className={s.attachButton}
                  type="button"
                  aria-label="上传对话附件"
                  title="上传文件或拖入此处：Markdown / TXT / PNG / JPG / WebP"
                  disabled={locked || pending}
                  onClick={open}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="17"
                    height="17"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    <path d="m9 17 8-8a3 3 0 0 0-4-4L5 13a5 5 0 0 0 7 7L21 11M8 14l7-7a1 1 0 0 1 2 2l-8 8" />
                  </svg>
                </button>
                <small title="Ctrl / ⌘ Enter 发送">
                  {pending ? "模型处理中" : configured ? model : "请先配置模型"}
                  {usage > 0 && ` · 对话 ${usage} tokens`}
                </small>
                <button
                  disabled={locked || pending || !text.trim() || !configured}
                  aria-label={
                    mode === "prototype"
                      ? "提交原型设计"
                      : mode === "clarify"
                        ? "发送需求"
                        : "提交修订"
                  }
                >
                  ↑
                </button>
              </div>
            </form>
          )}
        </AttachmentDropzone>
        <p className={s.uploadHint}>
          可拖入文本或图片 · Ctrl / ⌘ Enter 发送
          {images.length > 0 && (
            <>
              <br />
              原型图请在编辑区补充交互说明。
            </>
          )}
        </p>
      </div>
    </>
  );
}
