"use client";

import Link from "next/link";
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PrototypeFrame } from "@/components/workspace/prototype-frame";
import type {
  PrototypeStyle,
  ScreenshotReference,
  WorkspaceDocument,
  WorkspaceView,
} from "@/lib/contracts";
import {
  addScreenshot,
  appendEvent,
  createId,
  createWorkspace,
  updateMode,
} from "@/lib/workspace";

interface WorkspaceStudioProps {
  projectId: string;
}

const COMPONENTS = [
  { type: "button", label: "按钮", html: '<button data-prototype-node-id="{{id}}">新按钮</button>' },
  { type: "input", label: "输入框", html: '<input data-prototype-node-id="{{id}}" placeholder="请输入内容" />' },
  { type: "card", label: "卡片", html: '<section data-prototype-node-id="{{id}}" style="padding:20px;border:1px solid #dce4dd;border-radius:12px;background:#fff"><h2>卡片标题</h2><p>补充卡片内容。</p></section>' },
  { type: "table", label: "表格", html: '<table data-prototype-node-id="{{id}}" style="width:100%;border-collapse:collapse;background:#fff"><thead><tr><th>名称</th><th>状态</th></tr></thead><tbody><tr><td>示例数据</td><td>进行中</td></tr></tbody></table>' },
] as const;

const EMPTY_STYLE: PrototypeStyle = {
  width: "",
  minHeight: "",
  padding: "",
  margin: "",
  display: "",
  justifyContent: "",
  alignItems: "",
  textAlign: "left",
};

export function WorkspaceStudio({ projectId }: WorkspaceStudioProps) {
  const storageKey = `nexus-prd-workspace:${projectId}`;
  const [workspace, setWorkspace] = useState<WorkspaceDocument>(() => createWorkspace(projectId));
  const [view, setView] = useState<WorkspaceView>("split");
  const [interactive, setInteractive] = useState(false);
  const [activePanel, setActivePanel] = useState<"assistant" | "properties" | "events">("assistant");
  const [prompt, setPrompt] = useState("");
  const [captureRequest, setCaptureRequest] = useState(0);
  const [pendingCapture, setPendingCapture] = useState<string | undefined>();
  const [capturePurpose, setCapturePurpose] = useState("展示当前页面状态与核心操作入口");
  const [capturePosition, setCapturePosition] = useState<"cursor" | "end">("cursor");
  const [selectedStyle, setSelectedStyle] = useState<PrototypeStyle>(EMPTY_STYLE);
  const [savedAt, setSavedAt] = useState<string>();
  const prdEditor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return;
    try {
      setWorkspace(JSON.parse(saved) as WorkspaceDocument);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  const saveWorkspace = useCallback(() => {
    const next = appendEvent(workspace, {
      action: "workspace.saved",
      summary: "保存工作区快照",
      resourceKind: "workspace",
      metadata: {
        prdVersion: workspace.prdVersion,
        prototypeVersion: workspace.prototypeVersion,
      },
    });
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    setWorkspace(next);
    setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
  }, [storageKey, workspace]);

  const changePrd = (prd: string) => setWorkspace((current) => ({ ...current, prd }));
  const changePrototype = (prototypeHtml: string) =>
    setWorkspace((current) => ({ ...current, prototypeHtml }));

  const commitPrd = () => {
    setWorkspace((current) =>
      appendEvent(
        { ...current, prdVersion: current.prdVersion + 1 },
        {
          action: "prd.updated",
          summary: "保存 PRD 内容修改",
          resourceKind: "prd",
          resourceVersion: current.prdVersion + 1,
        },
      ),
    );
  };

  const commitPrototype = (summary = "保存原型代码修改") => {
    setWorkspace((current) =>
      appendEvent(
        { ...current, prototypeVersion: current.prototypeVersion + 1 },
        {
          action: "prototype.updated",
          summary,
          resourceKind: "prototype",
          resourceVersion: current.prototypeVersion + 1,
          metadata: { selectedNodeId: current.selectedNodeId ?? null },
        },
      ),
    );
  };

  const selectNode = useCallback((nodeId: string) => {
    setWorkspace((current) =>
      appendEvent(
        { ...current, selectedNodeId: nodeId },
        {
          action: "prototype.component_selected",
          summary: `选中原型组件 ${nodeId}`,
          resourceKind: "prototype",
          resourceVersion: current.prototypeVersion,
          metadata: { nodeId },
        },
      ),
    );
    setSelectedStyle(readNodeStyle(workspace.prototypeHtml, nodeId));
    setActivePanel("properties");
  }, [workspace.prototypeHtml]);

  const applyStyle = (key: keyof PrototypeStyle, value: string) => {
    const nodeId = workspace.selectedNodeId;
    if (!nodeId) return;
    const nextStyle = { ...selectedStyle, [key]: value };
    setSelectedStyle(nextStyle);
    setWorkspace((current) => ({
      ...current,
      prototypeHtml: writeNodeStyle(current.prototypeHtml, nodeId, key, value),
    }));
  };

  const insertComponent = (type: (typeof COMPONENTS)[number]["type"]) => {
    const component = COMPONENTS.find((item) => item.type === type);
    if (!component) return;
    const nodeId = createId(type);
    const snippet = component.html.replace("{{id}}", nodeId);
    setWorkspace((current) => ({
      ...current,
      prototypeHtml: insertBeforeBodyEnd(current.prototypeHtml, snippet),
      selectedNodeId: nodeId,
    }));
    setSelectedStyle(EMPTY_STYLE);
    commitPrototype(`插入${component.label}组件`);
    setActivePanel("properties");
  };

  const dropComponent = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/x-nexus-component");
    if (COMPONENTS.some((item) => item.type === type)) {
      insertComponent(type as (typeof COMPONENTS)[number]["type"]);
    }
  };

  const runAssistant = (event: FormEvent) => {
    event.preventDefault();
    const instruction = prompt.trim();
    if (!instruction) return;
    const correlationId = createId("correlation");
    setWorkspace((current) => {
      let next = appendEvent(current, {
        action: "assistant.requested",
        summary: instruction,
        resourceKind: "assistant",
        correlationId,
        metadata: { mode: current.aiMode },
      });
      next = {
        ...next,
        prototypeHtml: createPrototypeDraft(instruction, next.aiMode),
        prototypeVersion: next.prototypeVersion + 1,
      };
      return appendEvent(next, {
        action: "assistant.responded",
        summary: `${next.aiMode === "brainstorm" ? "快速" : "专业"}模式已生成原型草稿`,
        resourceKind: "assistant",
        resourceVersion: next.prototypeVersion,
        correlationId,
        causationId: next.events.at(-1)?.id,
      });
    });
    setPrompt("");
  };

  const receiveCapture = useCallback((dataUrl?: string) => {
    setWorkspace((current) => appendEvent(current, {
      action: "screenshot.captured",
      summary: dataUrl ? "已捕获当前原型画面" : "已记录当前原型状态，图片生成失败",
      resourceKind: "screenshot",
      resourceVersion: current.prototypeVersion,
      metadata: { nodeId: current.selectedNodeId ?? null, imageGenerated: Boolean(dataUrl) },
    }));
    setPendingCapture(dataUrl ?? "");
  }, []);

  const insertCapture = () => {
    const screenshot: ScreenshotReference = {
      id: createId("screenshot"),
      prototypeVersion: workspace.prototypeVersion,
      nodeId: workspace.selectedNodeId,
      imageDataUrl: pendingCapture || undefined,
      purpose: capturePurpose.trim() || "记录当前原型状态",
      insertedAt: new Date().toISOString(),
    };
    const markdown = `\n\n### 原型截图：${screenshot.purpose}\n\n${
      screenshot.imageDataUrl ? `![${screenshot.purpose}](${screenshot.imageDataUrl})\n\n` : ""
    }- 原型版本：v${screenshot.prototypeVersion}\n- 组件：${screenshot.nodeId ?? "整个页面"}\n- 预期结果：页面状态与需求描述一致。\n`;
    const editor = prdEditor.current;
    const position = capturePosition === "cursor" && editor ? editor.selectionStart : workspace.prd.length;
    const prd = `${workspace.prd.slice(0, position)}${markdown}${workspace.prd.slice(position)}`;
    setWorkspace((current) =>
      addScreenshot(
        { ...current, prd, prdVersion: current.prdVersion + 1 },
        screenshot,
      ),
    );
    setPendingCapture(undefined);
    setView("prd");
  };

  const viewTitle = useMemo(() => ({
    prd: "PRD 编辑",
    design: "原型设计",
    preview: "运行预览",
    split: "代码与预览",
  })[view], [view]);

  return (
    <div className="workspace-studio">
      <header className="workspace-toolbar">
        <div>
          <span className="workspace-breadcrumb">PROJECT / {projectId}</span>
          <small>历史本地工作区 · 新版请使用 <Link href="/prd-studio">PRD Studio</Link></small>
          <input
            className="workspace-title"
            value={workspace.title}
            onChange={(event) => setWorkspace((current) => ({ ...current, title: event.target.value }))}
            aria-label="工作区名称"
          />
        </div>
        <div className="workspace-actions">
          <div className="mode-switch" aria-label="AI 模式">
            <button
              className={workspace.aiMode === "brainstorm" ? "active" : ""}
              onClick={() => setWorkspace((current) => updateMode(current, "brainstorm"))}
            >头脑风暴</button>
            <button
              className={workspace.aiMode === "professional" ? "active" : ""}
              onClick={() => setWorkspace((current) => updateMode(current, "professional"))}
            >专业模式</button>
          </div>
          <span className="save-state">{savedAt ? `${savedAt} 已保存` : "本地草稿"}</span>
          <button className="secondary-button" onClick={() => setCaptureRequest((value) => value + 1)}>
            截图并插入 PRD
          </button>
          <button className="primary-button" onClick={saveWorkspace}>保存</button>
        </div>
      </header>

      <div className="workspace-body">
        <aside className="workspace-resources">
          <div className="resource-section">
            <span className="resource-label">文档</span>
            <button className={view === "prd" ? "resource-item active" : "resource-item"} onClick={() => setView("prd")}>
              <span>产品需求文档</span><small>v{workspace.prdVersion}</small>
            </button>
          </div>
          <div className="resource-section">
            <span className="resource-label">原型页面</span>
            <button className={view !== "prd" ? "resource-item active" : "resource-item"} onClick={() => setView("split")}>
              <span>主页面</span><small>v{workspace.prototypeVersion}</small>
            </button>
          </div>
          <div className="resource-section">
            <span className="resource-label">组件库 · 可拖入画布</span>
            <div className="component-grid">
              {COMPONENTS.map((component) => (
                <button
                  draggable
                  key={component.type}
                  onClick={() => insertComponent(component.type)}
                  onDragStart={(event) => event.dataTransfer.setData("application/x-nexus-component", component.type)}
                >{component.label}</button>
              ))}
            </div>
          </div>
          <div className="resource-section screenshots-list">
            <span className="resource-label">截图引用</span>
            {workspace.screenshots.length === 0 && <p>尚未插入截图</p>}
            {workspace.screenshots.map((item) => (
              <div key={item.id} className="screenshot-item">
                <strong>{item.purpose}</strong>
                <small>原型 v{item.prototypeVersion}{item.prototypeVersion < workspace.prototypeVersion ? " · 可能已过期" : ""}</small>
              </div>
            ))}
          </div>
        </aside>

        <main className="workspace-center">
          <div className="view-tabs">
            <strong>{viewTitle}</strong>
            <div>
              {(["prd", "design", "preview", "split"] as WorkspaceView[]).map((item) => (
                <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
                  {{ prd: "PRD", design: "设计", preview: "运行", split: "分屏" }[item]}
                </button>
              ))}
            </div>
          </div>

          {view === "prd" && (
            <section className="prd-editor-pane">
              <textarea
                ref={prdEditor}
                value={workspace.prd}
                onChange={(event) => changePrd(event.target.value)}
                onBlur={commitPrd}
                aria-label="PRD Markdown 编辑器"
              />
              <footer>Markdown · PRD v{workspace.prdVersion} · {workspace.prd.length.toLocaleString("zh-CN")} 字符</footer>
            </section>
          )}

          {view !== "prd" && (
            <section
              className={`prototype-workbench view-${view}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={dropComponent}
            >
              {(view === "design" || view === "split") && (
                <div className="code-pane">
                  <div className="pane-toolbar"><span>prototype.html</span><button onClick={() => commitPrototype()}>应用代码</button></div>
                  <textarea
                    value={workspace.prototypeHtml}
                    onChange={(event) => changePrototype(event.target.value)}
                    spellCheck={false}
                    aria-label="HTML 原型代码"
                  />
                </div>
              )}
              {(view === "preview" || view === "split" || view === "design") && (
                <div className="preview-pane">
                  <div className="pane-toolbar">
                    <span>{interactive ? "运行模式" : "选择模式"}</span>
                    <button onClick={() => setInteractive((value) => !value)}>
                      切换为{interactive ? "选择" : "运行"}
                    </button>
                  </div>
                  <PrototypeFrame
                    html={workspace.prototypeHtml}
                    interactive={interactive}
                    captureRequest={captureRequest}
                    onSelectNode={selectNode}
                    onCapture={receiveCapture}
                  />
                </div>
              )}
            </section>
          )}
        </main>

        <aside className="workspace-inspector">
          <div className="inspector-tabs">
            <button className={activePanel === "assistant" ? "active" : ""} onClick={() => setActivePanel("assistant")}>AI</button>
            <button className={activePanel === "properties" ? "active" : ""} onClick={() => setActivePanel("properties")}>属性</button>
            <button className={activePanel === "events" ? "active" : ""} onClick={() => setActivePanel("events")}>记录</button>
          </div>

          {activePanel === "assistant" && (
            <div className="inspector-content assistant-panel">
              <div className="mode-description">
                <strong>{workspace.aiMode === "brainstorm" ? "头脑风暴模式" : "专业模式"}</strong>
                <p>{workspace.aiMode === "brainstorm" ? "快速产生方向，允许基于显式假设继续。" : "加载完整上下文并执行质量与一致性检查。"}</p>
              </div>
              <form onSubmit={runAssistant}>
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：把首屏改成批量导入员工的后台页面……" />
                <button className="primary-button" type="submit">生成修改</button>
              </form>
              <p className="panel-hint">当前版本即时生成安全的页面草稿并记录完整版本链；后端模型接口将进一步返回结构化补丁。</p>
            </div>
          )}

          {activePanel === "properties" && (
            <div className="inspector-content property-panel">
              <div className="selection-name">{workspace.selectedNodeId ?? "请在原型中选择组件"}</div>
              {workspace.selectedNodeId && Object.entries({
                width: "宽度", minHeight: "最小高度", padding: "内边距", margin: "外边距",
                display: "布局", justifyContent: "主轴对齐", alignItems: "交叉轴对齐", textAlign: "文字对齐",
              }).map(([key, label]) => (
                <label key={key}><span>{label}</span><input value={selectedStyle[key as keyof PrototypeStyle] ?? ""} onChange={(event) => applyStyle(key as keyof PrototypeStyle, event.target.value)} placeholder="auto" /></label>
              ))}
              {workspace.selectedNodeId && <button className="secondary-button" onClick={() => commitPrototype("保存组件属性修改")}>保存属性版本</button>}
            </div>
          )}

          {activePanel === "events" && (
            <div className="inspector-content event-list">
              {[...workspace.events].reverse().map((event) => (
                <article key={event.id}>
                  <span>{event.sequence}</span>
                  <div><strong>{event.summary}</strong><small>{event.action} · {new Date(event.occurredAt).toLocaleTimeString("zh-CN")}</small><code>{event.correlationId}</code></div>
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>

      {pendingCapture !== undefined && (
        <div className="dialog-backdrop" role="presentation">
          <section className="capture-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-title">
            <h2 id="capture-title">截图并插入 PRD</h2>
            {pendingCapture ? <img src={pendingCapture} alt="原型截图预览" /> : <div className="capture-fallback">浏览器无法生成图片，将插入可追溯的原型状态引用。</div>}
            <label><span>目的说明</span><textarea value={capturePurpose} onChange={(event) => setCapturePurpose(event.target.value)} /></label>
            <label><span>插入位置</span><select value={capturePosition} onChange={(event) => setCapturePosition(event.target.value as "cursor" | "end")}><option value="cursor">PRD 当前光标</option><option value="end">PRD 文档末尾</option></select></label>
            <div className="dialog-actions"><button className="secondary-button" onClick={() => setPendingCapture(undefined)}>取消</button><button className="primary-button" onClick={insertCapture}>确认插入</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

function insertBeforeBodyEnd(html: string, snippet: string): string {
  return html.includes("</body>") ? html.replace("</body>", `\n${snippet}\n</body>`) : `${html}\n${snippet}`;
}

function readNodeStyle(html: string, nodeId: string): PrototypeStyle {
  const document = new DOMParser().parseFromString(html, "text/html");
  const element = document.querySelector<HTMLElement>(`[data-prototype-node-id="${CSS.escape(nodeId)}"]`);
  if (!element) return EMPTY_STYLE;
  return {
    width: element.style.width,
    minHeight: element.style.minHeight,
    padding: element.style.padding,
    margin: element.style.margin,
    display: element.style.display,
    justifyContent: element.style.justifyContent,
    alignItems: element.style.alignItems,
    textAlign: (element.style.textAlign as PrototypeStyle["textAlign"]) || "left",
  };
}

function writeNodeStyle(html: string, nodeId: string, key: keyof PrototypeStyle, value: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const element = document.querySelector<HTMLElement>(`[data-prototype-node-id="${CSS.escape(nodeId)}"]`);
  if (!element) return html;
  element.style[key] = value;
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function createPrototypeDraft(instruction: string, mode: WorkspaceDocument["aiMode"]): string {
  const title = escapeHtml(instruction.length > 46 ? `${instruction.slice(0, 46)}…` : instruction);
  const professionalSection = mode === "professional"
    ? `<section class="checks" data-prototype-node-id="quality-checks"><strong>专业检查</strong><span>✓ 主流程</span><span>✓ 空状态</span><span>✓ 异常反馈</span><span>✓ 验收入口</span></section>`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    *{box-sizing:border-box}body{margin:0;padding:34px;color:#18231f;background:#eef2ed;font-family:Inter,"Microsoft YaHei",sans-serif}.page{max-width:980px;margin:auto}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.badge{padding:6px 10px;border-radius:20px;color:#236c56;background:#dff0e8;font-size:11px}.hero,.panel,.checks{border:1px solid #d8e0da;border-radius:15px;background:#fff;box-shadow:0 16px 40px rgba(31,62,49,.07)}.hero{padding:30px}.hero h1{max-width:720px;margin:0 0 12px;font-size:30px}.hero p{color:#69766f;line-height:1.7}.actions{display:flex;gap:10px;margin-top:22px}button{border:0;border-radius:8px;padding:11px 16px;color:white;background:#1f725b;cursor:pointer}.ghost{color:#355148;background:#edf3ef}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}.panel{padding:18px}.panel small{color:#7a8780}.panel strong{display:block;margin-top:8px;font-size:22px}.checks{display:flex;align-items:center;gap:16px;margin-top:14px;padding:16px}.checks span{color:#28705a;font-size:12px}[data-prototype-node-id]:hover{outline:2px solid rgba(31,114,91,.3);outline-offset:3px}@media(max-width:700px){.grid{grid-template-columns:1fr}.checks{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
  <main class="page" data-prototype-node-id="generated-page">
    <header class="top" data-prototype-node-id="page-header"><strong>Nexus Prototype</strong><span class="badge">${mode === "brainstorm" ? "快速草稿" : "专业方案"}</span></header>
    <section class="hero" data-prototype-node-id="generated-hero">
      <h1 data-prototype-node-id="generated-title">${title}</h1>
      <p data-prototype-node-id="generated-description">这是根据当前产品意图生成的可运行页面草稿。你可以选择组件、修改属性或直接编辑代码继续完善。</p>
      <div class="actions" data-prototype-node-id="primary-actions"><button data-prototype-node-id="confirm-action" onclick="this.textContent='已完成操作'">开始操作</button><button class="ghost" data-prototype-node-id="secondary-action">查看说明</button></div>
    </section>
    <section class="grid" data-prototype-node-id="metric-grid"><article class="panel" data-prototype-node-id="metric-one"><small>待处理</small><strong>12</strong></article><article class="panel" data-prototype-node-id="metric-two"><small>进行中</small><strong>5</strong></article><article class="panel" data-prototype-node-id="metric-three"><small>已完成</small><strong>86%</strong></article></section>
    ${professionalSection}
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
