"use client";

import { validateDesign } from "./prototype";
import { useEditorTabs } from "@/components/workbench/use-editor-tabs";

import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentRenderer } from "@/components/workbench/document-renderer";
import {
  Brief,
  Configuration,
  DocumentSummary,
  Job,
  PrdDocument,
  Version,
  briefPayload,
  emptyBrief,
  prdApi,
} from "@/lib/prd-api";

export const fields: {
  key: Exclude<keyof Brief, "sources" | "prototype">;
  title: string;
  hint: string;
  rows: number;
  limit: number;
}[] = [
  {
    key: "title",
    title: "产品名称",
    hint: "你正在为哪个产品写需求？",
    rows: 1,
    limit: 200,
  },
  {
    key: "description",
    title: "产品构想与使用场景",
    hint: "描述产品要帮助用户完成的任务，也可以粘贴原始需求。",
    rows: 5,
    limit: 12000,
  },
  {
    key: "audience",
    title: "目标用户与角色",
    hint: "优先服务谁？使用者、管理者和购买者分别是谁？",
    rows: 3,
    limit: 4000,
  },
  {
    key: "problem",
    title: "问题与依据",
    hint: "用户现在怎么做，哪里不好？有哪些访谈、反馈或数据？",
    rows: 4,
    limit: 6000,
  },
  {
    key: "scope",
    title: "首版范围与非目标",
    hint: "必须有哪些功能？明确不做什么？已有优先级也写在这里。",
    rows: 5,
    limit: 8000,
  },
  {
    key: "constraints",
    title: "约束与已确认规则",
    hint: "平台、权限、数据、业务规则、期限、成本等。未知可以写待确认。",
    rows: 4,
    limit: 6000,
  },
  {
    key: "metrics",
    title: "成功指标与验收期待",
    hint: "什么结果代表解决了问题？注明口径及已确认的目标。",
    rows: 3,
    limit: 4000,
  },
  {
    key: "template",
    title: "文档模板（可选）",
    hint: "粘贴公司要求的目录和格式。留空则使用完整的软件 PRD 结构。",
    rows: 3,
    limit: 8000,
  },
];
const terminal = (status: string) =>
  ["succeeded", "failed", "cancelled"].includes(status);
const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";

export function usePrdStudio(initialTab?: "prototype") {
  const [brief, updateBrief] = useState<Brief>(emptyBrief);
  function setBrief(next: Brief) {
    const inputs = (value: Brief) =>
      JSON.stringify({ ...value, prototype: undefined });
    if (next.prototype?.confirmed && inputs(next) !== inputs(brief))
      next = { ...next, prototype: { ...next.prototype, confirmed: false } };
    updateBrief(next);
  }
  const [content, setContent] = useState("");
  const [document, setDocument] = useState<PrdDocument | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null,
  );
  const { tab, setTab, openTabs, closeTab } = useEditorTabs<
    | "prototype"
    | "grapes"
    | "brief"
    | "document"
    | "history"
    | "trace"
    | "assets"
    | "drawing"
    | "files"
    | "capabilities"
    | "settings"
    | `agent:${string}`
  >(initialTab ? [initialTab] : ["brief", "prototype", "document"], initialTab || "brief");
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const [thinkingPreferenceReady, setThinkingPreferenceReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const performing = useRef(false);
  const [streamError, setStreamError] = useState("");
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState<{
    brief: Brief;
    content: string;
    restored_from_version?: number | null;
  } | null>(null);
  const [localSaved, setLocalSaved] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const [restoredFrom, setRestoredFrom] = useState<number | null>(null);
  const storageKey = useRef("nexus-studio:new");
  const active = Boolean(
    document?.active_job_id || (job && !terminal(job.status)),
  );
  const dirty = document
    ? JSON.stringify(briefPayload(brief)) !==
        JSON.stringify(briefPayload(document.brief)) ||
      content !== document.content
    : JSON.stringify(brief) !== JSON.stringify(emptyBrief) || Boolean(content);

  async function refreshList() {
    const result = await prdApi<{ items: DocumentSummary[] }>("documents");
    setDocuments(result.items);
  }
  function accept(item: PrdDocument) {
    setDocument(item);
    updateBrief(item.brief);
    setContent(item.content);
    storageKey.current = `nexus-studio:${item.id}`;
  }

  useEffect(() => {
    let disposed = false;
    async function initialize() {
      const id = new URLSearchParams(window.location.search).get("id");
      storageKey.current = `nexus-studio:${id || "new"}`;
      try {
        const [config, list] = await Promise.all([
          prdApi<Configuration>("configuration"),
          prdApi<{ items: DocumentSummary[] }>("documents"),
        ]);
        if (disposed) return;
        setConfiguration(config);
        setDocuments(list.items);
        let item: PrdDocument | null = null;
        if (id) {
          item = await prdApi<PrdDocument>(`documents/${id}`);
          if (disposed) return;
          accept(item);
          if (initialTab) setTab(initialTab);
          else if (item.content) setTab("document");
          else if (item.brief.prototype) setTab("prototype");
          if (item.last_job_id) {
            const previousJob = await prdApi<Job>(`jobs/${item.last_job_id}`);
            if (disposed) return;
            setJob(previousJob);
          }
        }
        if (disposed) return;
        const cached = sessionStorage.getItem(storageKey.current);
        if (cached && !item?.active_job_id) {
          const draft = JSON.parse(cached);
          if (
            draft.brief &&
            typeof draft.content === "string" &&
            (!item ||
              draft.content !== item.content ||
              JSON.stringify(briefPayload(draft.brief)) !==
                JSON.stringify(briefPayload(item.brief)))
          ) {
            setRecovery(draft);
          }
        }
      } catch (err) {
        if (!disposed) setError(message(err));
      } finally {
        if (!disposed) setReady(true);
      }
    }
    void initialize();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    try {
      const preference = localStorage.getItem("nexus-prd:show-thinking");
      if (preference !== null) setShowThinking(preference === "true");
    } catch {
      /* The switch still works for this page session. */
    } finally {
      setThinkingPreferenceReady(true);
    }
  }, []);

  useEffect(() => {
    if (!thinkingPreferenceReady) return;
    try {
      localStorage.setItem("nexus-prd:show-thinking", String(showThinking));
    } catch {
      /* Preference persistence is optional. */
    }
  }, [showThinking, thinkingPreferenceReady]);

  useEffect(() => {
    if (!ready || !dirty || active || recovery) return;
    setLocalSaved(false);
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(
          storageKey.current,
          JSON.stringify({
            brief,
            content,
            restored_from_version: restoredFrom,
          }),
        );
        setLocalSaved(true);
      } catch {
        setNotice("浏览器草稿保存失败，请点击保存或导出文档。");
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [brief, content, ready, dirty, active, recovery, restoredFrom]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const jobId =
      document?.active_job_id || (job && !terminal(job.status) ? job.id : null);
    if (!jobId) return;
    let disposed = false;
    setStreamError("");
    const source = new EventSource(`/api/prd/jobs/${jobId}/stream`);
    async function finish(current: Job) {
      try {
        const item = await prdApi<PrdDocument>(`documents/${document!.id}`);
        if (disposed) return;
        accept(item);
        if (current.action === "prototype") setTab("prototype");
        else if (item.content) setTab("document");
        if (current.error) setError(current.error);
        else
          setNotice(
            current.status === "succeeded"
              ? current.action === "prototype"
                ? "原型已生成，可直接拖拽编辑；确认截图后可用于 PRD，也可直接编写 PRD。"
                : "任务已完成，文档已保存。请检查评审意见和待确认事项。"
              : "任务已停止，已完成结果保留。",
          );
        await refreshList();
      } catch (err) {
        if (!disposed) setError(message(err));
      }
    }
    source.onmessage = (event) => {
      if (disposed) return;
      setStreamError("");
      const current = JSON.parse(event.data) as Job;
      setJob(current);
      if (terminal(current.status)) {
        source.close();
        void finish(current);
      }
    };
    source.onerror = () => {
      if (!disposed) {
        setStreamError("实时连接中断，正在重连；服务端任务继续运行。");
        void prdApi<Job>(`jobs/${jobId}`)
          .then((current) => {
            if (disposed) return;
            setJob(current);
            if (terminal(current.status)) {
              source.close();
              void finish(current);
            }
          })
          .catch((err) => {
            if (!disposed) setError(message(err));
          });
      }
    };
    return () => {
      disposed = true;
      source.close();
    };
  }, [document?.active_job_id, document?.id, job?.id]);

  useEffect(() => {
    if (tab !== "history" || !document) return;
    prdApi<{ items: Version[] }>(`documents/${document.id}/versions`)
      .then((result) => setVersions(result.items))
      .catch((err) => setError(message(err)));
  }, [tab, document?.revision, document?.id]);

  async function save(value: Brief = brief, text: string = content): Promise<PrdDocument> {
    const brief = value;
    const content = text;
    if (!brief.title.trim()) throw new Error("请先填写产品名称");
    if (content.length > 200000)
      throw new Error("正文不能超过 200,000 字符，请减少配图或正文。");
    for (const page of brief.prototype?.pages || [])
      if (page.design) validateDesign(page.design);
    const payload = briefPayload(brief);
    const previousKey = storageKey.current;
    let item = document;
    if (!item) {
      item = await prdApi<PrdDocument>("documents", "POST", payload);
      setDocument(item);
      storageKey.current = `nexus-studio:${item.id}`;
      const studioPath = window.location.pathname === "/prototype-studio"
        ? "/prototype-studio" : "/prd-studio";
      window.history.replaceState(null, "", `${studioPath}?id=${item.id}`);
    }
    if (
      JSON.stringify(payload) !== JSON.stringify(briefPayload(item.brief)) ||
      content !== item.content
    ) {
      item = await prdApi<PrdDocument>(`documents/${item.id}`, "PUT", {
        expected_revision: item.revision,
        brief: payload,
        content,
        note: restoredFrom ? `从 v${restoredFrom} 载入后保存` : "手动保存",
        restored_from_version: restoredFrom,
      });
    }
    accept(item);
    setRestoredFrom(null);
    try {
      sessionStorage.removeItem(previousKey);
      sessionStorage.removeItem(storageKey.current);
    } catch {
      /* Server save is authoritative. */
    }
    setLocalSaved(false);
    setNotice("已保存到文档库");
    await refreshList();
    return item;
  }

  async function perform(action: () => Promise<unknown>) {
    if (performing.current) return;
    performing.current = true;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
      performing.current = false;
    }
  }

  async function start(
    action: "generate" | "revise" | "review" | "prototype",
    retryOf?: string,
    retryInstruction?: string,
    resumeOf?: string,
  ) {
    if (!resumeOf && !brief.description.trim())
      throw new Error("请先描述产品构想与使用场景");
    if (!configuration?.configured)
      throw new Error(
        "模型尚未配置。请先按页面说明配置 API 服务，文档编辑和保存可以继续使用。",
      );
    if (resumeOf && dirty)
      throw new Error("当前有修改，不能沿用旧现场；请选择重新执行。");
    const item = resumeOf && document ? document : await save();
    const current = await prdApi<Job>(`documents/${item.id}/jobs`, "POST", {
      expected_revision: item.revision,
      action,
      planning_mode: "controlled_dynamic",
      instruction: retryInstruction ?? instruction,
      show_thinking: showThinking,
      retry_of_job_id: retryOf || null,
      resume_of_job_id: resumeOf || null,
    });
    setJob(current);
    setShowThinking(current.show_thinking);
    setDocument({
      ...item,
      active_job_id: current.id,
      last_job_id: current.id,
    });
    setNotice("");
    setEditing(false);
  }

  function download(kind: "md" | "html") {
    const safeTitle = (brief.title || "PRD").replace(
      /[<>:"/\\|?*\u0000-\u001f]/g,
      "_",
    );
    let output = content;
    if (kind === "html") {
      const body = renderToStaticMarkup(
        <article>
          <DocumentRenderer content={content} />
        </article>,
      );
      output = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>产品需求文档</title><style>body{max-width:960px;margin:40px auto;padding:24px;font:16px/1.8 system-ui;color:#22332b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd6d0;padding:8px;text-align:left}pre{white-space:pre-wrap;background:#f2f5f3;padding:16px}blockquote{border-left:3px solid #48866c;padding-left:16px}h2{border-bottom:1px solid #ddd;padding-bottom:8px}.table-scroll{overflow:auto}@media print{body{margin:0;padding:0}}</style>${body}</html>`;
    }
    const url = URL.createObjectURL(
      new Blob([output], {
        type:
          kind === "md"
            ? "text/markdown;charset=utf-8"
            : "text/html;charset=utf-8",
      }),
    );
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeTitle}.${kind}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFiles(files: FileList | null, asDocument = false) {
    if (!files?.length) return;
    if (asDocument && content.trim())
      throw new Error(
        "当前已有正文。请新建文档后导入，或在编辑模式粘贴需要合并的内容。",
      );
    const additions = [];
    for (const file of Array.from(files)) {
      if (!/\.(md|txt|markdown)$/i.test(file.name))
        throw new Error(
          "目前支持 Markdown 和 TXT；其他格式请复制正文到参考材料。",
        );
      if (file.size > (asDocument ? 600000 : 80000))
        throw new Error(`${file.name} 过大，请精简后导入。`);
      const text = await file.text();
      if (asDocument) {
        if (text.length > 200000) throw new Error("正文不能超过 200,000 字符");
        setContent(text);
        setTab("document");
        setEditing(true);
        if (!brief.title)
          setBrief({ ...brief, title: file.name.replace(/\.[^.]+$/, "") });
        return;
      }
      if (text.length > 20000)
        throw new Error(`${file.name} 超过 20,000 字符，请精简后导入。`);
      additions.push({ name: file.name, content: text });
    }
    if (brief.sources.length + additions.length > 12)
      throw new Error("最多添加 12 份材料");
    if (
      [...brief.sources, ...additions].reduce(
        (sum, source) => sum + source.content.length,
        0,
      ) > 50000
    )
      throw new Error("参考材料合计不能超过 50,000 字符");
    setBrief({ ...brief, sources: [...brief.sources, ...additions] });
  }

  const missing = fields.filter(
    (field) => field.key !== "template" && !brief[field.key].trim(),
  );
  const reviewed =
    document?.review && !dirty && !active ? document.review : null;

  return {
    brief,
    setBrief,
    content,
    setContent,
    document,
    documents,
    versions,
    job,
    configuration,
    tab,
    setTab,
    openTabs,
    closeTab,
    editing,
    setEditing,
    instruction,
    setInstruction,
    showThinking,
    setShowThinking,
    error,
    setError,
    notice,
    setNotice,
    busy,
    ready,
    recovery,
    setRecovery,
    localSaved,
    selectedVersion,
    setSelectedVersion,
    restoredFrom,
    setRestoredFrom,
    active,
    dirty,
    missing,
    reviewed,
    save,
    start,
    perform,
    download,
    importFiles,
    accept,
    streamError,
    discardDraft: () => {
      sessionStorage.removeItem(storageKey.current);
      setRecovery(null);
    },
  };
}
