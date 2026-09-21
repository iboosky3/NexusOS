import type {
  AiMode,
  ScreenshotReference,
  WorkspaceDocument,
  WorkspaceEvent,
} from "@/lib/contracts";

export const DEFAULT_PROTOTYPE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; color: #17221e; background: #f5f7f3; font-family: Inter, "Microsoft YaHei", sans-serif; }
    .page { max-width: 960px; margin: 0 auto; }
    .hero { padding: 30px; border: 1px solid #dce4dd; border-radius: 16px; background: white; box-shadow: 0 18px 45px rgba(35, 64, 52, .08); }
    .eyebrow { color: #20745c; font-size: 12px; font-weight: 700; letter-spacing: .14em; }
    h1 { margin: 9px 0 12px; font-size: 34px; }
    p { color: #65736d; line-height: 1.7; }
    button { border: 0; border-radius: 9px; padding: 12px 18px; color: white; background: #1f725b; cursor: pointer; }
    [data-prototype-node-id] { outline: 0 solid transparent; transition: outline .15s; }
    [data-prototype-node-id]:hover { outline: 2px solid rgba(31, 114, 91, .28); outline-offset: 3px; }
  </style>
</head>
<body>
  <main class="page" data-prototype-node-id="page-root">
    <section class="hero" data-prototype-node-id="hero-card">
      <span class="eyebrow">NEXUS PRD PROTOTYPE</span>
      <h1 data-prototype-node-id="hero-title">从需求到可运行原型</h1>
      <p data-prototype-node-id="hero-copy">在左侧编辑 PRD，在这里直接运行和验证页面，并把关键状态插回需求文档。</p>
      <button data-prototype-node-id="primary-action" onclick="this.textContent='操作已记录'">开始体验</button>
    </section>
  </main>
</body>
</html>`;

export const DEFAULT_PRD = `# 产品需求文档

## 1. 背景与目标

在这里描述产品机会、目标用户和希望解决的问题。

## 2. 核心流程

1. 用户描述产品构想。
2. 系统生成可编辑 PRD 与可运行原型。
3. 用户验证页面并把关键状态截图插入 PRD。

## 3. 功能需求

- 支持直接编辑 PRD。
- 支持 HTML 原型实时预览。
- 所有关键操作可追溯。

## 4. 验收标准

- 修改原型代码后，工作区内实时显示结果。
`;

export function createWorkspace(projectId: string): WorkspaceDocument {
  const now = new Date().toISOString();
  return {
    projectId,
    title: "PRD 与原型协同工作区",
    aiMode: "brainstorm",
    prd: DEFAULT_PRD,
    prdVersion: 1,
    prototypeHtml: DEFAULT_PROTOTYPE_HTML,
    prototypeVersion: 1,
    screenshots: [],
    events: [
      {
        id: createId("event"),
        sequence: 1,
        action: "workspace.created",
        summary: "创建 PRD 与原型工作区",
        resourceKind: "workspace",
        correlationId: createId("correlation"),
        occurredAt: now,
      },
    ],
    updatedAt: now,
  };
}

export function appendEvent(
  workspace: WorkspaceDocument,
  input: Omit<WorkspaceEvent, "id" | "sequence" | "occurredAt" | "correlationId"> & {
    correlationId?: string;
  },
): WorkspaceDocument {
  const event: WorkspaceEvent = {
    ...input,
    id: createId("event"),
    sequence: workspace.events.length + 1,
    correlationId: input.correlationId ?? createId("correlation"),
    occurredAt: new Date().toISOString(),
  };
  return { ...workspace, events: [...workspace.events, event], updatedAt: event.occurredAt };
}

export function updateMode(workspace: WorkspaceDocument, mode: AiMode): WorkspaceDocument {
  if (workspace.aiMode === mode) return workspace;
  return appendEvent(
    { ...workspace, aiMode: mode },
    {
      action: "workspace.mode_changed",
      summary: `切换为${mode === "brainstorm" ? "头脑风暴" : "专业"}模式`,
      resourceKind: "workspace",
      metadata: { mode },
    },
  );
}

export function addScreenshot(
  workspace: WorkspaceDocument,
  screenshot: ScreenshotReference,
): WorkspaceDocument {
  return appendEvent(
    { ...workspace, screenshots: [...workspace.screenshots, screenshot] },
    {
      action: "screenshot.inserted",
      summary: `截图已插入 PRD：${screenshot.purpose}`,
      resourceKind: "screenshot",
      resourceVersion: screenshot.prototypeVersion,
      metadata: { nodeId: screenshot.nodeId ?? null },
    },
  );
}

export function createId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}
