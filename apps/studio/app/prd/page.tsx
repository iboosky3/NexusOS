"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrdMarkdown } from "@/components/prd-markdown";
import {
  Brief, Configuration, DocumentSummary, Job, PrdDocument, Version,
  emptyBrief, nexusBrief, prdApi,
} from "@/lib/prd-api";

const fields: { key: Exclude<keyof Brief, "sources">; title: string; hint: string; rows: number; limit: number }[] = [
  { key: "title", title: "产品名称", hint: "你正在为哪个产品写需求？", rows: 1, limit: 200 },
  { key: "description", title: "产品构想与使用场景", hint: "描述产品要帮助用户完成的任务，也可以粘贴原始需求。", rows: 5, limit: 12000 },
  { key: "audience", title: "目标用户与角色", hint: "优先服务谁？使用者、管理者和购买者分别是谁？", rows: 3, limit: 4000 },
  { key: "problem", title: "问题与依据", hint: "用户现在怎么做，哪里不好？有哪些访谈、反馈或数据？", rows: 4, limit: 6000 },
  { key: "scope", title: "首版范围与非目标", hint: "必须有哪些功能？明确不做什么？已有优先级也写在这里。", rows: 5, limit: 8000 },
  { key: "constraints", title: "约束与已确认规则", hint: "平台、权限、数据、业务规则、期限、成本等。未知可以写待确认。", rows: 4, limit: 6000 },
  { key: "metrics", title: "成功指标与验收期待", hint: "什么结果代表解决了问题？注明口径及已确认的目标。", rows: 3, limit: 4000 },
  { key: "template", title: "文档模板（可选）", hint: "粘贴公司要求的目录和格式。留空则使用完整的软件 PRD 结构。", rows: 3, limit: 8000 },
];
const terminal = (status: string) => ["succeeded", "failed", "cancelled"].includes(status);
const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
const formatDate = (value: string) => new Date(value).toLocaleString("zh-CN");

export default function PrdPage() {
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [content, setContent] = useState("");
  const [document, setDocument] = useState<PrdDocument | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [tab, setTab] = useState<"brief" | "document" | "history">("brief");
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState<{ brief: Brief; content: string } | null>(null);
  const [localSaved, setLocalSaved] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const storageKey = useRef("nexus-prd:new");
  const active = Boolean(document?.active_job_id || (job && !terminal(job.status)));
  const dirty = document ? JSON.stringify(brief) !== JSON.stringify(document.brief) || content !== document.content
    : Boolean(brief.title || brief.description || content);

  async function refreshList() {
    const result = await prdApi<{ items: DocumentSummary[] }>("documents");
    setDocuments(result.items);
  }
  function accept(item: PrdDocument) {
    setDocument(item); setBrief(item.brief); setContent(item.content);
    storageKey.current = `nexus-prd:${item.id}`;
  }

  useEffect(() => {
    let disposed = false;
    async function initialize() {
      const id = new URLSearchParams(window.location.search).get("id");
      storageKey.current = `nexus-prd:${id || "new"}`;
      try {
        const [config, list] = await Promise.all([
          prdApi<Configuration>("configuration"), prdApi<{ items: DocumentSummary[] }>("documents"),
        ]);
        if (disposed) return;
        setConfiguration(config); setDocuments(list.items);
        let item: PrdDocument | null = null;
        if (id) {
          item = await prdApi<PrdDocument>(`documents/${id}`);
          if (disposed) return;
          accept(item);
          if (item.content) setTab("document");
          if (item.last_job_id) setJob(await prdApi<Job>(`jobs/${item.last_job_id}`));
        }
        if (disposed) return;
        const request = new URLSearchParams(window.location.search).get("request");
        if (!id && request) setBrief({ ...emptyBrief, description: request });
        const cached = localStorage.getItem(storageKey.current);
        if (cached && !item?.active_job_id) {
          const draft = JSON.parse(cached);
          if (draft.brief && typeof draft.content === "string" &&
              (!item || draft.content !== item.content || JSON.stringify(draft.brief) !== JSON.stringify(item.brief))) {
            setRecovery(draft);
          }
        }
      } catch (err) { if (!disposed) setError(message(err)); }
      finally { if (!disposed) setReady(true); }
    }
    void initialize();
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!ready || !dirty || active || recovery) return;
    setLocalSaved(false);
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey.current, JSON.stringify({ brief, content }));
        setLocalSaved(true);
      } catch { setNotice("浏览器草稿保存失败，请点击保存或导出文档。"); }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [brief, content, ready, dirty, active, recovery]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const jobId = document?.active_job_id || (job && !terminal(job.status) ? job.id : null);
    if (!jobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current = await prdApi<Job>(`jobs/${jobId}`);
        if (disposed) return;
        setJob(current);
        if (terminal(current.status)) {
          const item = await prdApi<PrdDocument>(`documents/${document!.id}`);
          if (disposed) return;
          accept(item);
          if (item.content) setTab("document");
          if (current.error) setError(current.error);
          else setNotice("任务已完成，文档已保存。请检查评审意见和待确认事项。");
          await refreshList();
          return;
        }
      } catch (err) { if (!disposed) setError(message(err)); }
      if (!disposed) timer = setTimeout(poll, 1500);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [document?.active_job_id, document?.id, job?.id]);

  useEffect(() => {
    if (tab !== "history" || !document) return;
    prdApi<{ items: Version[] }>(`documents/${document.id}/versions`)
      .then(result => setVersions(result.items)).catch(err => setError(message(err)));
  }, [tab, document?.revision, document?.id]);

  async function save(): Promise<PrdDocument> {
    if (!brief.title.trim()) throw new Error("请先填写产品名称");
    const previousKey = storageKey.current;
    let item = document;
    if (!item) {
      item = await prdApi<PrdDocument>("documents", "POST", brief);
      setDocument(item);
      storageKey.current = `nexus-prd:${item.id}`;
      window.history.replaceState(null, "", `/prd?id=${item.id}`);
    }
    if (JSON.stringify(brief) !== JSON.stringify(item.brief) || content !== item.content) {
      item = await prdApi<PrdDocument>(`documents/${item.id}`, "PUT", {
        expected_revision: item.revision, brief, content, note: "手动保存",
      });
    }
    accept(item);
    try { localStorage.removeItem(previousKey); localStorage.removeItem(storageKey.current); } catch { /* Server save is authoritative. */ }
    setLocalSaved(false); setNotice("已保存到文档库");
    await refreshList();
    return item;
  }

  async function perform(action: () => Promise<unknown>) {
    setError(""); setNotice(""); setBusy(true);
    try { await action(); } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  async function start(action: "generate" | "revise" | "review") {
    if (!configuration?.configured) throw new Error("模型尚未配置。请先按页面说明配置 API 服务，文档编辑和保存可以继续使用。");
    const item = await save();
    const current = await prdApi<Job>(`documents/${item.id}/jobs`, "POST", {
      expected_revision: item.revision, action, instruction,
    });
    setJob(current); setDocument({ ...item, active_job_id: current.id, last_job_id: current.id });
    setNotice(""); setEditing(false);
  }

  function download(kind: "md" | "html") {
    const safeTitle = (brief.title || "PRD").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    let output = content;
    if (kind === "html") {
      const body = renderToStaticMarkup(<article><PrdMarkdown content={content} /></article>);
      output = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>产品需求文档</title><style>body{max-width:960px;margin:40px auto;padding:24px;font:16px/1.8 system-ui;color:#22332b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd6d0;padding:8px;text-align:left}pre{white-space:pre-wrap;background:#f2f5f3;padding:16px}blockquote{border-left:3px solid #48866c;padding-left:16px}h2{border-bottom:1px solid #ddd;padding-bottom:8px}.table-scroll{overflow:auto}@media print{body{margin:0;padding:0}}</style>${body}</html>`;
    }
    const url = URL.createObjectURL(new Blob([output], { type: kind === "md" ? "text/markdown;charset=utf-8" : "text/html;charset=utf-8" }));
    const anchor = window.document.createElement("a");
    anchor.href = url; anchor.download = `${safeTitle}.${kind}`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFiles(files: FileList | null, asDocument = false) {
    if (!files?.length) return;
    if (asDocument && content.trim()) throw new Error("当前已有正文。请新建文档后导入，或在编辑模式粘贴需要合并的内容。");
    const additions = [];
    for (const file of Array.from(files)) {
      if (!/\.(md|txt|markdown)$/i.test(file.name)) throw new Error("目前支持 Markdown 和 TXT；其他格式请复制正文到参考材料。");
      if (file.size > (asDocument ? 600000 : 80000)) throw new Error(`${file.name} 过大，请精简后导入。`);
      const text = await file.text();
      if (asDocument) {
        if (text.length > 200000) throw new Error("正文不能超过 200,000 字符");
        setContent(text); setTab("document"); setEditing(true);
        if (!brief.title) setBrief({ ...brief, title: file.name.replace(/\.[^.]+$/, "") });
        return;
      }
      if (text.length > 20000) throw new Error(`${file.name} 超过 20,000 字符，请精简后导入。`);
      additions.push({ name: file.name, content: text });
    }
    if (brief.sources.length + additions.length > 12) throw new Error("最多添加 12 份材料");
    if ([...brief.sources, ...additions].reduce((sum, source) => sum + source.content.length, 0) > 50000) throw new Error("参考材料合计不能超过 50,000 字符");
    setBrief({ ...brief, sources: [...brief.sources, ...additions] });
  }

  const missing = fields.filter(field => !["title", "template"].includes(field.key) && !brief[field.key].trim());
  const reviewed = document?.review && !dirty && !active ? document.review : null;

  return <div className="prd-page">
    <Link className="back-link" href="/">← 工作台</Link>
    <header className="prd-header">
      <div><span className="panel-kicker">NEXUS PRD / WORKSPACE</span><h1>{brief.title || "编写产品需求文档"}</h1><p>从需求与材料出发，写清楚产品行为和验收条件。</p></div>
      <div className="prd-actions"><span className="save-state" role="status">{active ? job?.stage || "执行中" : busy ? "正在保存…" : dirty ? localSaved ? "浏览器草稿 · 待保存到文档库" : "有未保存修改" : document ? `已保存 · v${document.version}` : "新文档"}</span>
        <button className="secondary-button" disabled={busy || active || !ready || Boolean(recovery)} onClick={() => void perform(save)}>保存</button>
        {!content && <button className="primary-button" disabled={busy || active || !ready || Boolean(recovery)} onClick={() => void perform(() => start("generate"))}>生成 PRD →</button>}
      </div>
    </header>
    {error && <div className="prd-alert error" role="alert">{error}<button onClick={() => setError("")} aria-label="关闭错误">×</button></div>}
    {notice && <div className="prd-alert" role="status">{notice}</div>}
    {recovery && <div className="prd-alert recovery">发现尚未保存到文档库的浏览器草稿。
      <button className="secondary-button" onClick={() => { setBrief(recovery.brief); setContent(recovery.content); setRecovery(null); setNotice("已恢复浏览器草稿，请检查后保存。"); }}>恢复草稿</button>
      <button className="secondary-button" onClick={() => { localStorage.removeItem(storageKey.current); setRecovery(null); }}>使用服务器版本</button>
    </div>}
    {configuration && !configuration.configured && <details className="prd-alert"><summary>尚未配置生成模型，仍可编辑、导入和保存文档</summary><p>在 API 服务环境中设置 NEXUS_MODEL_NAME、NEXUS_MODEL_BASE_URL 和 NEXUS_MODEL_API_KEY，安装 runtime 依赖并重启 API。配置完成后刷新页面。密钥只保留在服务端。</p></details>}
    <div className="workspace-grid">
      <div className="workspace-main">
        <nav className="prd-tabs" aria-label="文档视图">{([['brief', '需求与材料'], ['document', 'PRD 正文'], ['history', '版本历史']] as const).map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
        {tab === "brief" && <section className="editor-panel panel">
          <div className="editor-toolbar"><span>已确认的信息越具体，初稿越接近可评审状态。</span>{!document && !dirty && <button className="text-button" disabled={active || busy} onClick={() => setBrief(nexusBrief)}>为 NexusOS 自己写 PRD</button>}</div>
          <fieldset disabled={active || busy || !ready || Boolean(recovery)}>
            {fields.map(field => <label key={field.key} htmlFor={`brief-${field.key}`}>{field.title}{field.key === "title" ? " *" : ""}
              {field.rows === 1 ? <input id={`brief-${field.key}`} value={brief[field.key]} maxLength={field.limit} placeholder={field.hint} onChange={event => setBrief({ ...brief, [field.key]: event.target.value })} />
                : <textarea id={`brief-${field.key}`} rows={field.rows} maxLength={field.limit} value={brief[field.key]} placeholder={field.hint} onChange={event => setBrief({ ...brief, [field.key]: event.target.value })} />}
            </label>)}
            <div className="source-heading"><h2>参考材料</h2><label className="secondary-button file-button">导入 .md / .txt<input type="file" multiple accept=".md,.txt,.markdown" onChange={event => { void perform(() => importFiles(event.target.files)); event.target.value = ""; }} /></label></div>
            <p className="field-hint">材料会按 S1、S2 编号供模型引用。链接不会自动抓取，请提供正文。单份最多 20,000 字符，合计 50,000。</p>
            {brief.sources.map((source, index) => <div className="source-card" key={index}>
              <label>S{index + 1} · 来源名称<input aria-label={`S${index + 1} 来源名称`} value={source.name} maxLength={200} onChange={event => setBrief({ ...brief, sources: brief.sources.map((s, i) => i === index ? { ...s, name: event.target.value } : s) })} /></label>
              <label>正文<textarea aria-label={`S${index + 1} 正文`} value={source.content} rows={5} maxLength={20000} onChange={event => setBrief({ ...brief, sources: brief.sources.map((s, i) => i === index ? { ...s, content: event.target.value } : s) })} /></label>
              <button className="text-button" onClick={() => setBrief({ ...brief, sources: brief.sources.filter((_, i) => i !== index) })}>移除材料</button>
            </div>)}
            <button className="secondary-button" disabled={brief.sources.length >= 12} onClick={() => setBrief({ ...brief, sources: [...brief.sources, { name: "", content: "" }] })}>＋ 粘贴一份材料</button>
          </fieldset>
        </section>}
        {tab === "document" && <section className="panel prd-document">
          <div className="document-toolbar"><div><button className={!editing ? "text-button selected" : "text-button"} onClick={() => setEditing(false)}>预览</button><button className={editing ? "text-button selected" : "text-button"} onClick={() => setEditing(true)}>编辑 Markdown</button></div>
            <div><button className="text-button" disabled={!content} onClick={() => download("md")}>导出 MD</button><button className="text-button" disabled={!content} onClick={() => download("html")}>导出 HTML</button></div></div>
          {!content && !editing ? <div className="prd-empty"><h2>这里将保存你的 PRD</h2><p>填写需求后生成初稿，或导入已有文档继续写作。</p><label className="secondary-button file-button">导入已有 PRD<input type="file" accept=".md,.txt,.markdown" disabled={busy || active} onChange={event => { void perform(() => importFiles(event.target.files, true)); event.target.value = ""; }} /></label><button className="text-button" onClick={() => setEditing(true)}>直接开始写</button></div>
            : editing ? <textarea className="markdown-editor" aria-label="PRD Markdown 正文" value={content} maxLength={200000} disabled={active || busy || Boolean(recovery)} onChange={event => setContent(event.target.value)} placeholder="# 产品需求文档" />
              : <article className="markdown-content"><PrdMarkdown content={content} /></article>}
        </section>}
        {tab === "history" && <section className="panel editor-panel"><h2>已保存的版本</h2><p className="field-hint">恢复会先载入编辑区；点击保存后产生新版本，历史记录保留。</p>
          {!versions.length && <p>还没有版本。保存修改或生成文档后会记录在这里。</p>}
          {versions.map(version => <button className="version-row" key={version.version} onClick={() => setSelectedVersion(version)}><strong>v{version.version} · {version.note}</strong><span>{formatDate(version.created_at)} →</span></button>)}
          {selectedVersion && <div className="version-preview"><div className="document-toolbar"><strong>预览 v{selectedVersion.version}</strong><button className="secondary-button" disabled={active || busy || Boolean(recovery)} onClick={() => { setBrief(selectedVersion.brief); setContent(selectedVersion.content); setTab("document"); setEditing(true); setNotice(`已载入 v${selectedVersion.version}，保存后成为新版本。`); }}>载入此版本</button></div><article className="markdown-content"><PrdMarkdown content={selectedVersion.content || "此版本仅保存了需求简报。"} /></article></div>}
        </section>}
      </div>
      <aside className="workspace-aside">
        {active && <section className="panel prd-side"><span className="panel-kicker">正在处理</span><h2>{job?.stage || "等待执行"}</h2><p>可以离开页面稍后回来，生成结果会保存到文档库。</p><ol className="stage-list">{job?.steps.map(step => <li key={step.id}>{step.status === "succeeded" ? "✓" : "◌"} {step.title}</li>)}</ol><button className="secondary-button" disabled={busy} onClick={() => void perform(async () => { if (job) await prdApi(`jobs/${job.id}/cancel`, "POST"); })}>停止任务</button></section>}
        {!active && content && <section className="panel prd-side"><span className="panel-kicker">继续完善</span><h2>按反馈修订</h2><label htmlFor="revision-instruction" className="field-hint">说明要改什么、哪些要求必须保留</label><textarea id="revision-instruction" className="revision-input" rows={5} value={instruction} maxLength={8000} onChange={event => setInstruction(event.target.value)} placeholder="例如：补齐 FR-003 的权限校验和失败恢复，其他需求保持不变。" /><button className="primary-button full-button" disabled={busy || !instruction.trim() || Boolean(recovery)} onClick={() => void perform(() => start("revise"))}>修订并生成新版本</button><button className="secondary-button full-button" disabled={busy || Boolean(recovery)} onClick={() => void perform(() => start("review"))}>仅评审当前文档</button></section>}
        <section className="panel prd-side"><span className="panel-kicker">需求澄清</span><h2>{missing.length ? `${missing.length} 项信息待补充` : "检查关键假设"}</h2><p>可以先生成草稿；未知信息会要求模型标注为待确认，交付前仍需你做决定。</p><div className="clarification-list">{missing.map(field => <button key={field.key} onClick={() => { setTab("brief"); setTimeout(() => window.document.getElementById(`brief-${field.key}`)?.focus(), 50); }}><strong>{field.title} ↗</strong><span>{field.hint}</span></button>)}</div></section>
        {content && <section className="panel prd-side"><span className="panel-kicker">质量评审</span><h2>{reviewed ? reviewed.issues.length ? `${reviewed.issues.length} 项修改意见` : "等待人工评审" : "尚无当前版本评审"}</h2><p>{reviewed?.summary || "编辑内容或需求后需重新评审。AI 评审结果不能替代人工验收。"}</p>{reviewed?.issues.map((issue, index) => <div className="review-issue" key={index}><strong>{({ blocker: "阻断", major: "主要", minor: "建议" })[issue.severity]} · {issue.section}</strong><p>{issue.problem}</p><p>建议：{issue.suggestion}</p></div>)}{reviewed && <small>{reviewed.notice}</small>}</section>}
        {job && <details className="panel prd-side"><summary>任务记录 · {job.status === "succeeded" ? "已完成" : job.status === "failed" ? "失败" : job.status === "cancelled" ? "已停止" : "执行中"}</summary><p>输入 {job.input_tokens.toLocaleString()} / 输出 {job.output_tokens.toLocaleString()} tokens</p>{job.error && <p role="alert">{job.error}</p>}{job.steps.map(step => <details className="step-details" key={step.id}><summary>{step.title} · {step.status === "succeeded" ? "完成" : "未完成"}</summary><p>{step.agent_id} · {step.skill_ids.join("、")}</p><pre>{step.content || "尚无输出"}</pre></details>)}</details>}
        <section className="panel prd-side"><div className="document-toolbar"><h2>文档库</h2><a className="text-button" href="/prd">＋ 新建</a></div>{!documents.length && <p>保存第一份需求后，可在这里重新打开。</p>}<div className="document-list">{documents.map(item => <a key={item.id} href={`/prd?id=${item.id}`} aria-current={document?.id === item.id ? "page" : undefined}><strong>{item.title}</strong><small>{item.active_job_id ? "处理中" : `v${item.version}`} · {formatDate(item.updated_at)}</small></a>)}</div></section>
      </aside>
    </div>
  </div>;
}
