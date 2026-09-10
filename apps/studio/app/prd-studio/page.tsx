"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  Workbench,
  EditorTabs,
  PanelHeading,
  WorkbenchCommand,
} from "@/components/workbench/workbench";
import {
  Capability,
  CapabilityBrowser,
} from "@/components/workbench/capability-browser";
import {
  DocumentRenderer,
  FlowDiagram,
  imageToDataUrl,
} from "@/components/workbench/document-renderer";
import { BriefEditor } from "@/components/prd-studio/brief-editor";
import { MarkdownEditor } from "@/components/workbench/markdown-editor";
import { PrdAssistant } from "@/components/prd-studio/assistant";
import { PrdRecovery } from "@/components/prd-recovery";
import { Job, prdApi } from "@/lib/prd-api";
import { usePrdStudio } from "@/lib/use-prd-studio";
import s from "@/components/prd-studio/studio.module.css";

const PrdTrace = dynamic(
  () => import("@/components/prd-trace").then((module) => module.PrdTrace),
  { loading: () => <p>正在载入追溯面板…</p> },
);
type Tab = ReturnType<typeof usePrdStudio>["tab"];
const tabs = [
  { id: "brief", label: "需求简报", icon: "▤" },
  { id: "document", label: "PRD.md", icon: "#" },
  { id: "drawing", label: "流程图", icon: "⌘" },
  { id: "assets", label: "参考材料", icon: "♧" },
  { id: "history", label: "版本", icon: "◴" },
  { id: "trace", label: "追溯", icon: "⑂" },
];
const views = [
  { id: "capabilities", label: "能力", icon: "◇" },
  { id: "files", label: "文件", icon: "▤" },
  { id: "assets", label: "素材", icon: "▧" },
  { id: "history", label: "版本", icon: "◴" },
  { id: "settings", label: "设置", icon: "⚙" },
];

export default function PrdStudio() {
  const w = usePrdStudio();
  const [side, setSide] = useState("capabilities");
  const [catalog, setCatalog] = useState<{
    agents: Capability[];
    skills: Capability[];
  }>({ agents: [], skills: [] });
  const [catalogError, setCatalogError] = useState("");
  const [focusChat, setFocusChat] = useState(0);
  const [chatMode, setChatMode] = useState<"clarify" | "revise">("clarify");
  const [bottom, setBottom] = useState("tasks");
  const [flow, setFlow] = useState("");
  const [split, setSplit] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [chatKey, setChatKey] = useState("new");
  const sourceInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const locked = w.active || w.busy || !w.ready || Boolean(w.recovery);
  useEffect(() => {
    setChatKey(new URLSearchParams(window.location.search).get("id") || "new");
  }, []);
  useEffect(() => {
    let disposed = false;
    prdApi<typeof catalog>("capabilities")
      .then((value) => {
        if (!disposed) setCatalog(value);
      })
      .catch((err) => {
        if (!disposed) setCatalogError(err.message);
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        if (!locked) void w.perform(w.save);
      }
    };
    window.addEventListener("keydown", save);
    return () => window.removeEventListener("keydown", save);
  }, [locked, w.save]);
  const execute = (job: Job, mode: "restart" | "resume") => {
    void w.perform(() =>
      w.start(
        job.action,
        mode === "restart" ? job.id : undefined,
        job.instruction,
        mode === "resume" ? job.id : undefined,
      ),
    );
  };
  function view(id: string) {
    setSide(id);
    if (["assets", "history"].includes(id)) w.setTab(id as Tab);
  }
  function insert(value: string) {
    const next = `${w.content}${w.content ? "\n\n" : ""}${value}`;
    if (next.length > 200000)
      throw new Error("插入后正文超过 200,000 字符，请压缩配图或减少内容。");
    w.setContent(next);
    w.setTab("document");
    w.setEditing(false);
    w.setNotice("已插入文档，点击保存后保存到文档库。");
  }
  const run = () => {
    if (w.content) {
      setChatMode("revise");
      setFocusChat((value) => value + 1);
      w.setNotice("请在右侧说明修改要求，然后提交修订。");
    } else void w.perform(() => w.start("generate"));
  };
  const commands: WorkbenchCommand[] = [
    {
      id: "new",
      label: "新建 PRD 工作区",
      run: () => {
        window.open("/prd-studio", "_blank", "noopener,noreferrer");
      },
    },
    {
      id: "save",
      label: "保存文档 · Ctrl/⌘ S",
      run: () => {
        void w.perform(w.save);
      },
      disabled: locked,
    },
    {
      id: "import",
      label: "导入 Markdown 文档",
      run: () => documentInput.current?.click(),
      disabled: locked || Boolean(w.content),
    },
    {
      id: "export-md",
      label: "导出 Markdown",
      run: () => w.download("md"),
      disabled: !w.content,
    },
    {
      id: "export-html",
      label: "导出 HTML（包含配图）",
      run: () => w.download("html"),
      disabled: !w.content,
    },
    { id: "brief", label: "编辑需求简报", run: () => w.setTab("brief") },
    {
      id: "edit",
      label: "编辑 Markdown",
      run: () => {
        w.setTab("document");
        w.setEditing(true);
      },
    },
    {
      id: "split",
      label: "切换 Markdown 分屏预览",
      run: () => {
        w.setTab("document");
        w.setEditing(true);
        setSplit((value) => !value);
      },
    },
    {
      id: "image",
      label: "插入配图",
      run: () => imageInput.current?.click(),
      disabled: locked,
    },
    { id: "flow", label: "编辑流程图", run: () => w.setTab("drawing") },
    {
      id: "catalog",
      label: "查看 Agent / Skill 注册清单",
      run: () => setSide("capabilities"),
    },
    {
      id: "clarify",
      label: "开始需求澄清",
      run: () => {
        setChatMode("clarify");
        setFocusChat((value) => value + 1);
      },
    },
    {
      id: "generate",
      label: "运行 PRD 工作流",
      run,
      disabled: locked || !w.configuration?.configured,
    },
    {
      id: "review",
      label: "评审当前文档",
      run: () => {
        void w.perform(() => w.start("review"));
      },
      disabled: locked || !w.content || !w.configuration?.configured,
    },
    {
      id: "stop",
      label: "停止任务",
      run: () => {
        void w.perform(async () => {
          if (w.job) await prdApi(`jobs/${w.job.id}/cancel`, "POST");
        });
      },
      disabled: !w.active || w.busy,
    },
    { id: "history", label: "版本历史", run: () => w.setTab("history") },
    { id: "trace", label: "全程追溯", run: () => w.setTab("trace") },
    { id: "help", label: "使用说明与模型配置", run: () => setSide("settings") },
  ];
  const menu = (label: string, ids: string[]) => ({
    label,
    commands: commands.filter((command) => ids.includes(command.id)),
  });
  const status = w.active
    ? w.job?.stage || "正在运行"
    : w.busy
      ? "处理中…"
      : w.dirty
        ? w.localSaved
          ? "浏览器草稿 · 待保存"
          : "未保存修改"
        : w.document
          ? `已保存 · v${w.document.version}`
          : "新工作区";
  return (
    <Workbench
      title="PRD Studio"
      home={
        <Link href="/" aria-label="返回首页">
          ◈
        </Link>
      }
      menus={[
        menu("文件", ["new", "save", "import", "export-md", "export-html"]),
        menu("编辑", ["brief", "edit", "image", "flow"]),
        menu("视图", ["split", "history", "trace"]),
        menu("Agent", ["catalog", "clarify"]),
        menu("Skill", ["catalog", "flow"]),
        menu("运行", ["generate", "review", "stop"]),
        menu("帮助", ["help"]),
      ]}
      commands={commands}
      toolbar={
        <>
          <div className={s.identity}>
            <strong>▤ {w.brief.title || "未命名 PRD"}</strong>
            <span role="status">● {status}</span>
          </div>
          <div className={s.actions}>
            <Link
              href={w.document ? `/prd?id=${w.document.id}` : "/prd"}
              target="_blank"
              rel="noopener noreferrer"
            >
              旧版 ↗
            </Link>
            <button disabled={locked} onClick={() => void w.perform(w.save)}>
              保存
            </button>
            <details className={s.exportMenu}>
              <summary>⇧ 导出</summary>
              <button disabled={!w.content} onClick={() => w.download("md")}>
                Markdown
              </button>
              <button disabled={!w.content} onClick={() => w.download("html")}>
                HTML
              </button>
            </details>
            <button
              className={s.primary}
              disabled={locked || !w.configuration?.configured}
              onClick={run}
            >
              ▷ {w.content ? "修订文档" : "运行工作流"}
            </button>
          </div>
        </>
      }
      views={views}
      activeView={side}
      onView={view}
      sidebar={
        side === "capabilities" ? (
          <CapabilityBrowser
            {...catalog}
            used={w.job?.steps.flatMap((step) => [
              step.agent_id,
              ...step.skill_ids,
            ])}
            error={catalogError}
          />
        ) : side === "settings" ? (
          <>
            <PanelHeading>工作区设置</PanelHeading>
            <div className={s.sidebarContent}>
              <h3>模型连接</h3>
              <p>
                {w.configuration?.configured
                  ? `已配置：${w.configuration.model}`
                  : "模型尚未配置"}
              </p>
              <p>生成、修订和 AI 澄清使用 API 服务配置的模型。</p>
              <p>
                在服务器 .env 设置
                NEXUS_MODEL_NAME、NEXUS_MODEL_BASE_URL、NEXUS_MODEL_API_KEY，重启
                API 后刷新页面。
              </p>
              <h3>操作说明</h3>
              <p>简报填写 → AI 澄清 → 应用建议 → 保存 → 生成 → 编辑 / 评审。</p>
              <p>
                Ctrl / ⌘ S 保存。侧栏可拖动右下角调整宽度，底部按钮可收起面板。
              </p>
              <p>
                配图支持 PNG、JPG、WebP；文本资料支持 Markdown /
                TXT。流程图按每行一个节点编辑。
              </p>
              <p>未配置图像生成服务，配图可手动导入。AI 不会分析配图像素。</p>
            </div>
          </>
        ) : (
          <>
            <PanelHeading>
              {side === "files"
                ? "资源管理器"
                : side === "history"
                  ? "版本管理"
                  : "素材管理"}
            </PanelHeading>
            <div className={s.sidebarContent}>
              {tabs.slice(0, 4).map((tab) => (
                <button
                  className={s.file}
                  key={tab.id}
                  onClick={() => w.setTab(tab.id as Tab)}
                >
                  {tab.icon}{" "}
                  {tab.id === "document"
                    ? `${w.brief.title || "未命名 PRD"}.md`
                    : tab.label}
                </button>
              ))}
              <h3>文档库</h3>
              <input
                placeholder="搜索文档"
                aria-label="搜索文档"
                value={fileSearch}
                onChange={(event) => setFileSearch(event.target.value)}
              />
              {w.documents
                .filter((item) =>
                  item.title.toLowerCase().includes(fileSearch.toLowerCase()),
                )
                .map((item) => (
                  <a
                    className={s.libraryItem}
                    key={item.id}
                    href={`/prd-studio?id=${item.id}`}
                  >
                    <strong>{item.title}</strong>
                    <small>
                      {item.active_job_id ? "正在处理" : `v${item.version}`} ·{" "}
                      {new Date(item.updated_at).toLocaleDateString("zh-CN")}
                    </small>
                  </a>
                ))}
              {!w.documents.length && <p>保存第一份需求后，会出现在这里。</p>}
            </div>
          </>
        )
      }
      assistantFocusToken={focusChat}
      assistant={
        <PrdAssistant
          brief={w.brief}
          onBrief={w.setBrief}
          content={w.content}
          model={w.configuration?.model || ""}
          configured={Boolean(w.configuration?.configured)}
          locked={locked}
          showThinking={w.showThinking}
          onThinking={w.setShowThinking}
          job={w.job}
          onRevise={(instruction) =>
            w.perform(() => w.start("revise", undefined, instruction))
          }
          onNotice={w.setNotice}
          focusToken={focusChat}
          requestedMode={chatMode}
          documentKey={w.document?.id || chatKey}
        />
      }
      bottom={
        <>
          <nav className={s.bottomNav}>
            {[
              ["tasks", "工作流"],
              ["output", "输出"],
              ["issues", `待确认 ${w.missing.length}`],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={bottom === id}
                onClick={() => setBottom(id)}
              >
                {label}
              </button>
            ))}
            <button onClick={() => w.setTab("trace")}>追溯 ↗</button>
            {w.active && (
              <button
                disabled={w.busy}
                onClick={() =>
                  commands.find((command) => command.id === "stop")?.run()
                }
              >
                停止任务
              </button>
            )}
          </nav>
          {bottom === "tasks" ? (
            <div className={s.steps}>
              {w.job?.steps.length
                ? w.job.steps.map((step) => (
                    <div key={step.id}>
                      <span
                        className={
                          step.status === "succeeded" ? s.done : undefined
                        }
                      >
                        {step.status === "succeeded"
                          ? "✓"
                          : step.status === "running"
                            ? "◌"
                            : "·"}
                      </span>
                      <div>
                        <strong>{step.title}</strong>
                        <small>
                          {step.status === "succeeded"
                            ? "已完成"
                            : step.status === "running"
                              ? "运行中"
                              : step.status === "failed"
                                ? "失败"
                                : step.status === "cancelled"
                                  ? "已停止"
                                  : "等待"}
                        </small>
                      </div>
                    </div>
                  ))
                : ["需求澄清", "需求分析", "撰写 PRD", "独立评审"].map(
                    (label, index) => (
                      <div key={label}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{label}</strong>
                          <small>
                            {index
                              ? "等待"
                              : w.missing.length
                                ? "完善需求简报"
                                : "可以生成草稿"}
                          </small>
                        </div>
                      </div>
                    ),
                  )}
            </div>
          ) : bottom === "output" ? (
            <pre className={s.output}>
              {w.job?.stream?.content ||
                "尚无任务输出。运行工作流后，这里实时显示阶段内容。"}
            </pre>
          ) : (
            <div className={s.issueLinks}>
              {w.missing.map((field) => (
                <button
                  key={field.key}
                  onClick={() => {
                    w.setTab("brief");
                    setTimeout(
                      () =>
                        document.getElementById(`studio-${field.key}`)?.focus(),
                      0,
                    );
                  }}
                >
                  {field.title} ↗
                </button>
              ))}
              {!w.missing.length && (
                <span>信息已填写，仍需确认假设与生成内容。</span>
              )}
            </div>
          )}
        </>
      }
      status={
        <>
          <span>◉ {status}</span>
          <span>{w.missing.length} 项待补充</span>
        </>
      }
      statusRight={
        <>
          <span>{w.configuration?.model || "模型未配置"}</span>
          <span>
            Token：
            {(
              (w.job?.input_tokens || 0) + (w.job?.output_tokens || 0)
            ).toLocaleString()}
          </span>
        </>
      }
    >
      <EditorTabs
        tabs={tabs}
        value={w.tab}
        onChange={(id) => w.setTab(id as Tab)}
      />
      {w.error && (
        <div className={s.bannerError} role="alert">
          {w.error}
          <button aria-label="关闭错误" onClick={() => w.setError("")}>
            ×
          </button>
        </div>
      )}
      {w.notice && (
        <div className={s.banner} role="status">
          {w.notice}
          <button aria-label="关闭提示" onClick={() => w.setNotice("")}>
            ×
          </button>
        </div>
      )}
      {w.streamError && (
        <div className={s.banner} role="status">
          {w.streamError}
        </div>
      )}
      {w.recovery && (
        <div className={s.banner}>
          发现本标签页未保存的草稿。
          <button
            onClick={() => {
              if (!w.recovery) return;
              w.setBrief(w.recovery.brief);
              w.setContent(w.recovery.content);
              w.setRestoredFrom(w.recovery.restored_from_version ?? null);
              w.setRecovery(null);
            }}
          >
            恢复草稿
          </button>
          <button onClick={w.discardDraft}>使用服务器版本</button>
        </div>
      )}
      {!w.configuration?.configured && w.ready && (
        <div className={s.banner}>
          可以填写、编辑和保存。生成前请配置模型。
          <button onClick={() => setSide("settings")}>查看配置</button>
        </div>
      )}
      <div className={s.viewport}>
        {!w.active && w.job && (
          <PrdRecovery
            job={w.job}
            disabled={locked}
            dirty={w.dirty}
            onExecute={execute}
          />
        )}
        {w.tab === "brief" && (
          <BriefEditor
            brief={w.brief}
            onChange={w.setBrief}
            disabled={locked}
            onSources={() => w.setTab("assets")}
          />
        )}
        {w.tab === "document" && (
          <>
            <MarkdownEditor
              value={w.content}
              onChange={w.setContent}
              editing={w.editing}
              onEditing={w.setEditing}
              split={split}
              onSplit={setSplit}
              disabled={locked}
              label="PRD Markdown 正文"
              placeholder="# 产品需求文档"
              actions={
                <>
                  <button
                    disabled={locked}
                    onClick={() => imageInput.current?.click()}
                  >
                    ▧ 配图
                  </button>
                  <button onClick={() => w.setTab("drawing")}>⌘ 流程图</button>
                  <button
                    disabled={
                      locked || !w.content || !w.configuration?.configured
                    }
                    onClick={() => void w.perform(() => w.start("review"))}
                  >
                    ✓ 评审
                  </button>
                </>
              }
              empty={
                <div className={s.empty}>
                  <span>▤</span>
                  <h2>开始你的第一份 PRD</h2>
                  <p>先填写需求简报，再运行工作流；也可以导入已有文档。</p>
                  <button
                    disabled={locked}
                    onClick={() => documentInput.current?.click()}
                  >
                    导入 Markdown
                  </button>
                </div>
              }
            />
            {w.reviewed && (
              <section className={s.review}>
                <h2>质量评审</h2>
                <p>{w.reviewed.summary}</p>
                {w.reviewed.issues.map((issue, index) => (
                  <div key={index}>
                    <strong>
                      {issue.section} · {issue.severity}
                    </strong>
                    <p>{issue.problem}</p>
                    <p>建议：{issue.suggestion}</p>
                  </div>
                ))}
                <small>{w.reviewed.notice}</small>
              </section>
            )}
          </>
        )}
        {w.tab === "assets" && (
          <section className={s.assetEditor}>
            <h1>参考材料与配图</h1>
            <p>文本材料供模型引用；配图插入正文，随版本保存与导出。</p>
            <div className={s.actions}>
              <button
                disabled={locked}
                onClick={() => sourceInput.current?.click()}
              >
                ＋ 导入 Markdown / TXT
              </button>
              <button
                disabled={locked || w.brief.sources.length >= 12}
                onClick={() =>
                  w.setBrief({
                    ...w.brief,
                    sources: [...w.brief.sources, { name: "", content: "" }],
                  })
                }
              >
                粘贴材料
              </button>
              <button
                disabled={locked}
                onClick={() => imageInput.current?.click()}
              >
                ▧ 插入配图
              </button>
              <button onClick={() => w.setTab("drawing")}>编辑流程图</button>
            </div>
            <p className={s.muted}>
              最多 12 份文本材料，合计 50,000 字符。PNG / JPG / WebP
              会压缩后嵌入正文。
            </p>
            {w.brief.sources.map((source, index) => (
              <fieldset key={index} disabled={locked} className={s.sourceCard}>
                <label>
                  S{index + 1} · 来源名称
                  <input
                    value={source.name}
                    maxLength={200}
                    onChange={(event) =>
                      w.setBrief({
                        ...w.brief,
                        sources: w.brief.sources.map((item, i) =>
                          i === index
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  来源正文
                  <textarea
                    rows={7}
                    value={source.content}
                    maxLength={20000}
                    onChange={(event) =>
                      w.setBrief({
                        ...w.brief,
                        sources: w.brief.sources.map((item, i) =>
                          i === index
                            ? { ...item, content: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  onClick={() =>
                    w.setBrief({
                      ...w.brief,
                      sources: w.brief.sources.filter((_, i) => i !== index),
                    })
                  }
                >
                  移除来源
                </button>
              </fieldset>
            ))}
            {!w.brief.sources.length && (
              <div className={s.empty}>尚未添加参考材料</div>
            )}
          </section>
        )}
        {w.tab === "drawing" && (
          <section className={s.assetEditor}>
            <h1>流程图编辑器</h1>
            <p>
              每行一个节点，最多 20 个节点、每个节点 26 字。插入后可在 Markdown
              的 nexus-flow 代码块内修改。
            </p>
            <textarea
              aria-label="流程图节点"
              rows={5}
              value={flow}
              maxLength={2000}
              onChange={(event) => setFlow(event.target.value)}
              placeholder={"用户提交\n系统校验\n确认结果"}
              disabled={locked}
            />
            <div className={s.drawing}>
              <FlowDiagram value={flow} />
            </div>
            <button
              className={s.primary}
              disabled={locked || !flow.trim()}
              onClick={() =>
                void w.perform(async () => {
                  const nodes = flow
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean);
                  if (
                    nodes.length > 20 ||
                    nodes.some(
                      (node) => node.length > 26 || node.includes("```"),
                    )
                  )
                    throw new Error(
                      "最多 20 个节点，每个节点 26 字，不能包含代码块标记",
                    );
                  insert(`\n\`\`\`nexus-flow\n${nodes.join("\n")}\n\`\`\``);
                })
              }
            >
              插入 PRD 文档
            </button>
          </section>
        )}
        {w.tab === "history" && (
          <section className={s.assetEditor}>
            <h1>版本历史</h1>
            <p>载入后点击保存会创建新版本。</p>
            {w.versions.map((version) => (
              <button
                className={s.version}
                key={version.version}
                onClick={() => w.setSelectedVersion(version)}
              >
                <strong>
                  v{version.version} · {version.note}
                </strong>
                <small>
                  {new Date(version.created_at).toLocaleString("zh-CN")}
                </small>
              </button>
            ))}
            {!w.versions.length && <p>尚无已保存版本。</p>}
            {w.selectedVersion && (
              <>
                <button
                  disabled={locked}
                  onClick={() => {
                    if (!w.selectedVersion) return;
                    w.setBrief(w.selectedVersion.brief);
                    w.setContent(w.selectedVersion.content);
                    w.setRestoredFrom(w.selectedVersion.version);
                    w.setTab("document");
                    w.setEditing(true);
                    w.setNotice("已载入历史版本，请检查后保存。");
                  }}
                >
                  载入 v{w.selectedVersion.version} 到编辑区
                </button>
                <article className="markdown-content">
                  <DocumentRenderer
                    content={w.selectedVersion.content || "此版本仅包含简报。"}
                  />
                </article>
              </>
            )}
          </section>
        )}
        {w.tab === "trace" &&
          (w.document ? (
            <PrdTrace
              documentId={w.document.id}
              refreshKey={`${w.document.revision}:${w.job?.stage}:${w.job?.status}`}
              disabled={locked}
              dirty={w.dirty}
              onExecute={execute}
            />
          ) : (
            <div className={s.empty}>保存文档后可查看全程追溯。</div>
          ))}
      </div>
      <input
        hidden
        ref={sourceInput}
        type="file"
        accept=".md,.txt,.markdown"
        multiple
        onChange={(event) => {
          const files = event.target.files;
          void w.perform(() => w.importFiles(files));
          event.target.value = "";
        }}
      />
      <input
        hidden
        ref={documentInput}
        type="file"
        accept=".md,.txt,.markdown"
        onChange={(event) => {
          const files = event.target.files;
          void w.perform(() => w.importFiles(files, true));
          event.target.value = "";
        }}
      />
      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            void w.perform(async () => {
              const url = await imageToDataUrl(file);
              insert(`![${file.name.replace(/[\[\]\\\n\r]/g, "_")}](${url})`);
            });
          event.target.value = "";
        }}
      />
    </Workbench>
  );
}
