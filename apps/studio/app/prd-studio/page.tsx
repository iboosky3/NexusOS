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
import { ExtensionBrowser } from "@/components/workbench/extension-browser";
import { useWorkbenchExtensions } from "@/lib/workbench-extensions";
import { prototypeDesigner } from "@/extensions/prototype-designer/manifest";
import type { Capability } from "@/components/workbench/capability-browser";

import {
  DocumentRenderer,
  FlowDiagram,
} from "@/components/workbench/document-renderer";
import { BriefEditor } from "@/components/prd-studio/brief-editor";
import { MarkdownEditor } from "@/components/workbench/markdown-editor";
import { PrdAssistant } from "@/components/prd-studio/assistant";
import { PrdRunPanel } from "@/components/prd-studio/run-panel";
import { PrototypeEditor } from "@/components/prd-studio/prototype-editor";
import { Job, prdApi } from "@/lib/prd-api";
import { usePrdStudio } from "@/lib/use-prd-studio";
import { preparePrdAttachments } from "@/lib/prd-attachments";
import s from "@/components/prd-studio/studio.module.css";

const CapabilityBrowser = dynamic(() =>
  import("@/components/workbench/capability-browser").then(
    (module) => module.CapabilityBrowser,
  ),
);

type Tab = ReturnType<typeof usePrdStudio>["tab"];
const tabs = [
  { id: "brief", label: "需求简报", icon: "▤" },
  { id: "prototype", label: "原型设计", icon: "▧" },
  { id: "document", label: "PRD.md", icon: "#" },
  { id: "drawing", label: "流程图", icon: "⌘" },
  { id: "assets", label: "参考材料", icon: "♧" },
  { id: "history", label: "版本", icon: "◴" },
  { id: "files", label: "文档库", icon: "▤" },
  { id: "settings", label: "使用说明", icon: "?" },
];

export default function PrdStudio() {
  const w = usePrdStudio();
  const extensions = useWorkbenchExtensions();
  const [runPanel, setRunPanel] = useState(false);
  const [runFocus, setRunFocus] = useState(0);
  function openRun() {
    setRunPanel(true);
    setRunFocus((value) => value + 1);
  }
  useEffect(() => {
    if (w.job?.id) openRun();
  }, [w.job?.id]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [side, setSide] = useState("workspace");
  const [showLabels, setShowLabels] = useState(true);
  useEffect(() => {
    try {
      setShowLabels(
        localStorage.getItem("nexus-workbench:activity-labels") !== "false",
      );
    } catch {
      /* Optional display preference. */
    }
  }, []);
  function toggleLabels() {
    const next = !showLabels;
    setShowLabels(next);
    try {
      localStorage.setItem("nexus-workbench:activity-labels", String(next));
    } catch {
      /* Display still updates for this session. */
    }
  }
  const [sidebarFocus, setSidebarFocus] = useState(0);
  function showCapabilities(kind: "agents" | "skills" = "agents") {
    setSide(kind);
    setSidebarFocus((value) => value + 1);
  }
  const [catalog, setCatalog] = useState<{
    agents: Capability[];
    skills: Capability[];
  }>({ agents: [], skills: [] });
  const [catalogError, setCatalogError] = useState("");
  const [focusChat, setFocusChat] = useState(0);
  const [flow, setFlow] = useState("");
  const [split, setSplit] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [chatKey, setChatKey] = useState("new");
  const sourceInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const locked =
    w.active || w.busy || attachmentBusy || !w.ready || Boolean(w.recovery);
  async function attachFiles(files: File[]) {
    const result = await preparePrdAttachments(files, w.brief, w.content);
    w.setBrief(result.brief);
    w.setContent(result.content);
    if (result.images) w.setTab("prototype");
    w.setNotice(
      result.images
        ? "原型图已加入工作区，请在原型设计中补充页面与交互说明并确认。"
        : "附件已加入参考材料，下一次对话和生成会使用这些材料；请在文件菜单保存。",
    );
  }
  useEffect(() => {
    setChatKey(new URLSearchParams(window.location.search).get("id") || "new");
  }, []);
  useEffect(() => {
    if (side !== "agents" && side !== "skills") return;
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
  }, [side]);
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
    const hasProse = w.content
      .replace(
        /<!-- nexus-prototype:start -->[\s\S]*?<!-- nexus-prototype:end -->/g,
        "",
      )
      .replace(/!\[[^\]\n]*\]\([^\s)]+\)/g, "")
      .trim();
    if (hasProse) {
      w.setTab("document");
      setFocusChat((value) => value + 1);
      w.setNotice("请在右侧说明修改要求，然后提交修订。");
    } else void w.perform(() => w.start("generate"));
  };
  const commands: WorkbenchCommand[] = [
    {
      id: "extensions",
      label: "管理工作台插件",
      run: () => {
        setSide("extensions");
        setSidebarFocus((value) => value + 1);
      },
    },
    {
      id: "activity-labels",
      label: showLabels ? "隐藏侧边栏文字" : "显示侧边栏文字",
      run: toggleLabels,
    },
    {
      id: "skills",
      label: "查看 Skill 注册清单",
      run: () => showCapabilities("skills"),
    },
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
    { id: "prototype", label: "原型设计", run: () => w.setTab("prototype") },
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
      label: "导入原型图",
      run: () => imageInput.current?.click(),
      disabled: locked,
    },
    { id: "flow", label: "编辑流程图", run: () => w.setTab("drawing") },
    {
      id: "catalog",
      label: "查看 Agent 注册清单",
      run: () => showCapabilities("agents"),
    },
    {
      id: "clarify",
      label: "开始需求澄清",
      run: () => {
        w.setTab("brief");
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
    { id: "trace", label: "运行面板与追溯", run: openRun },
    { id: "files", label: "打开文档库", run: () => w.setTab("files") },
    {
      id: "legacy",
      label: "打开旧版 PRD",
      run: () => {
        window.open(
          w.document ? `/prd?id=${w.document.id}` : "/prd",
          "_blank",
          "noopener,noreferrer",
        );
      },
    },
    { id: "sources", label: "参考材料", run: () => w.setTab("assets") },
    {
      id: "help",
      label: "使用说明与模型配置",
      run: () => w.setTab("settings"),
    },
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
        menu("编辑", ["brief", "prototype", "edit"]),
        menu("视图", [
          "split",
          "activity-labels",
          "extensions",
          "files",
          "history",
          "trace",
        ]),
        menu("运行", ["generate", "review", "stop", "trace"]),
        menu("帮助", ["help", "legacy"]),
      ]}
      views={[
        { id: "workspace", label: "资源", icon: "▤" },
        { id: "agents", label: "Agent", icon: "◇" },
        { id: "skills", label: "Skill", icon: "✧" },
        {
          id: "extensions",
          label: "插件",
          icon: (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <path d="M3 3h7v7H3zM3 14h7v7H3zM14 14h7v7h-7zM16 2l6 2-2 6-6-2z" />
            </svg>
          ),
        },
      ]}
      showActivityLabels={showLabels}
      activeView={side}
      onView={setSide}
      sidebarFocusToken={sidebarFocus}
      sidebar={
        side === "extensions" ? (
          <ExtensionBrowser
            extensions={[prototypeDesigner.manifest]}
            enabled={extensions.enabled}
            onToggle={extensions.toggle}
            disabled={locked || !extensions.ready}
            onOpen={() => w.setTab("prototype")}
          />
        ) : side === "agents" || side === "skills" ? (
          <CapabilityBrowser
            key={side}
            kind={side === "agents" ? "agents" : "skills"}
            {...catalog}
            used={w.job?.steps.flatMap((step) => [
              step.agent_id,
              ...step.skill_ids,
            ])}
            error={catalogError}
          />
        ) : (
          <>
            <PanelHeading>项目资源</PanelHeading>
            <div className={s.projectResources}>
              <button onClick={() => w.setTab("assets")}>
                <span>♧ 参考材料</span>
                <small>{w.brief.sources.length || "添加"}</small>
              </button>
              {w.brief.sources.length > 0 && (
                <ul>
                  {w.brief.sources.map((source, index) => (
                    <li key={index} title={source.name}>
                      S{index + 1} · {source.name || "未命名材料"}
                    </li>
                  ))}
                </ul>
              )}
              {w.document && (
                <button onClick={() => w.setTab("history")}>
                  <span>◴ 版本历史</span>
                  <small>v{w.document.version}</small>
                </button>
              )}
              <hr />
              <button onClick={() => w.setTab("files")}>
                <span>▤ 文档库</span>
                <small>{w.documents.length}</small>
              </button>
            </div>
          </>
        )
      }
      bottomFocusToken={runFocus}
      bottom={
        runPanel
          ? ({ expanded, toggleExpanded }) => (
              <PrdRunPanel
                expanded={expanded}
                onToggleExpanded={toggleExpanded}
                hasBrief={Boolean(w.brief.title && w.brief.description)}
                prototypeState={
                  w.brief.prototype?.confirmed
                    ? "confirmed"
                    : w.brief.prototype
                      ? "draft"
                      : "none"
                }
                job={w.job}
                documentId={w.document?.id}
                showThinking={w.showThinking}
                locked={locked}
                dirty={w.dirty}
                onExecute={execute}
                onClose={() => setRunPanel(false)}
              />
            )
          : undefined
      }
      status={<span role="status">◉ {status}</span>}
      statusRight={<span>Markdown · 本地工作区</span>}
      commands={commands}
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
          onPrototype={(instruction) =>
            w.perform(() => w.start("prototype", undefined, instruction))
          }
          onRevise={(instruction) =>
            w.perform(() => w.start("revise", undefined, instruction))
          }
          onNotice={w.setNotice}
          focusToken={focusChat}
          requestedMode={
            w.tab === "document"
              ? "revise"
              : w.tab === "prototype"
                ? "prototype"
                : "clarify"
          }
          documentKey={w.document?.id || chatKey}
          onUpload={attachFiles}
          onUploadBusy={setAttachmentBusy}
          onOpenSources={() => w.setTab("assets")}
          onOpenDocument={() => w.setTab("prototype")}
        />
      }
    >
      <EditorTabs
        tabs={tabs
          .filter((tab, index) => index < 3 || tab.id === w.tab)
          .map((tab) =>
            tab.id === "document"
              ? { ...tab, label: `${w.brief.title || "未命名"}.md` }
              : tab,
          )}
        onClose={
          w.tab === "brief" || w.tab === "document" || w.tab === "prototype"
            ? undefined
            : () => w.setTab(w.content ? "document" : "brief")
        }
        closableIds={tabs.slice(3).map((tab) => tab.id)}
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
          <button onClick={() => w.setTab("settings")}>查看配置</button>
        </div>
      )}
      <div className={s.viewport}>
        {w.tab === "prototype" && (
          <PrototypeEditor
            key={`${w.document?.id || "new"}:${w.document?.revision || 0}`}
            designerEnabled={
              extensions.ready &&
              extensions.enabled(prototypeDesigner.manifest.id)
            }
            onOpenExtensions={() => {
              setSide("extensions");
              setSidebarFocus((value) => value + 1);
            }}
            onEmbed={(next) => {
              w.setContent(next);
              w.setTab("document");
              w.setEditing(false);
              w.setNotice(
                "原型截图和交互说明已更新到 PRD，请通过文件菜单保存。",
              );
            }}
            onSave={async (prototype) => {
              w.setBrief({ ...w.brief, prototype });
              await w.perform(() => w.save({ ...w.brief, prototype }));
            }}
            content={w.content}
            brief={w.brief}
            onBrief={w.setBrief}
            disabled={locked}
            onBusy={setAttachmentBusy}
            onGenerate={(instruction) => {
              openRun();
              void w.perform(() =>
                w.start("prototype", undefined, instruction),
              );
            }}
            onImport={() => imageInput.current?.click()}
          />
        )}
        {w.tab === "settings" && (
          <section className={s.assetEditor}>
            <h1>使用说明</h1>
            <label>规划模式
              <select aria-label="PRD 规划模式" value="controlled_dynamic" onChange={() => {}}>
                <option value="controlled_dynamic">任务驱动的受控动态流程（默认）</option>
                <option value="ai_dynamic" disabled>AI 自主规划 DAG（PRD 接入待验收）</option>
              </select>
            </label>
            <p>PRD 按任务选择阶段并保留写作与评审流程。<Link href="/">从首页描述目标，组装任务工作台</Link></p>
            <p>
              填写简报 → 编写 PRD（可选原型设计） → 编辑或与 AI 修订 →
              保存与导出。
            </p>
            <p>
              在原型设计中管理页面与截图，正文可插入流程图；参考材料与版本在左侧管理，运行详情集中在底部面板。
            </p>
            <p>Ctrl / ⌘ S 保存，Ctrl / ⌘ Shift P 搜索命令。</p>
            <h2>模型配置</h2>
            <p>
              {w.configuration?.configured
                ? `已配置：${w.configuration.model}`
                : "尚未配置模型"}
            </p>
            <p>
              在 API 服务环境中设置 NEXUS_MODEL_NAME、NEXUS_MODEL_BASE_URL 和
              NEXUS_MODEL_API_KEY，重启服务后刷新。使用 .env
              时需要由启动脚本加载。
            </p>
            <p>
              支持导入原型图、AI
              生成可点击线框页面、截图入文和顺序流程图。导入图片需要补充交互说明，当前不进行图像识别。
            </p>
          </section>
        )}
        {w.tab === "files" && (
          <section className={s.assetEditor}>
            <h1>文档库</h1>
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
            {!w.documents.length && <p>保存第一份文档后，会出现在这里。</p>}
          </section>
        )}
        {w.tab === "brief" && (
          <BriefEditor
            brief={w.brief}
            onChange={w.setBrief}
            disabled={locked}
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
                    onClick={() => w.setTab("prototype")}
                  >
                    ▧ 原型图
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
            <h1>参考材料</h1>
            <p>添加访谈记录、业务规则等，供编写时引用。</p>
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
            </div>
            <p className={s.muted}>最多 12 份文本材料，合计 50,000 字符。</p>
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
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          if (files.length) void w.perform(() => attachFiles(files));
        }}
      />
    </Workbench>
  );
}
