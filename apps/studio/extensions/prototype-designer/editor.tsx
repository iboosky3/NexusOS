"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Puck, usePuck } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import {
  type DesignBlock, type PrototypeDesign, type PrototypeSelection,
  type PrototypePatchRequest, findDesignBlock, validateDesign,
} from "@/lib/prototype";
import { designerConfig, pageDesign } from "./config";
import type { DesignerProps } from "./manifest";
import s from "./editor.module.css";

function HistoryButtons() {
  const { history, appState } = usePuck();
  const settled =
    JSON.stringify(history.histories[history.index]?.state.data) ===
    JSON.stringify(appState.data);
  return <>
    <button disabled={!settled || !history.hasPast} onClick={history.back} title="撤销">↶</button>
    <button disabled={!settled || !history.hasFuture} onClick={history.forward} title="重做">↷</button>
  </>;
}

function SelectionBridge({
  pageId, pageTitle, onSelection,
}: {
  pageId: string;
  pageTitle: string;
  onSelection: (selection: PrototypeSelection | null) => void;
}) {
  const { selectedItem, appState } = usePuck();
  const id = String(selectedItem?.props.id || "");
  const block = id ? findDesignBlock(appState.data.content as DesignBlock[], id) : undefined;
  const signature = block ? JSON.stringify(block) : "";
  const previous = useRef<string>("");
  useEffect(() => {
    const next = `${pageId}:${signature}`;
    if (previous.current === next) return;
    previous.current = next;
    onSelection(block ? { pageId, pageTitle, block } : null);
  }, [pageId, pageTitle, signature, onSelection, block]);
  return null;
}

function ComponentPatchBridge({
  request, pageId, onApplied,
}: {
  request?: PrototypePatchRequest | null;
  pageId: string;
  onApplied: (error?: string) => void;
}) {
  const { appState, dispatch } = usePuck();
  const handled = useRef("");
  useEffect(() => {
    if (!request || request.pageId !== pageId || handled.current === request.nonce) return;
    handled.current = request.nonce;
    const current = findDesignBlock(
      appState.data.content as DesignBlock[], request.componentId,
    );
    if (!current || JSON.stringify(current) !== request.before) {
      onApplied("组件在建议期间已变更，请重新选择组件并提问。");
      return;
    }
    const updated: DesignBlock = {
      ...current,
      props: {
        ...current.props,
        ...request.patch,
        appearance: request.patch.appearance
          ? { ...current.props.appearance, ...request.patch.appearance }
          : current.props.appearance,
      },
    };
    const replace = (blocks: DesignBlock[]): DesignBlock[] => blocks.map((block) => {
      if (block.props.id === request.componentId) return updated;
      if (block.type !== "Columns" && block.type !== "Row") return block;
      return { ...block, props: { ...block.props,
        left: replace(block.props.left || []), right: replace(block.props.right || []),
      } };
    });
    const content = replace(appState.data.content as DesignBlock[]);
    try {
      validateDesign({
        engine: "puck", version: 1, width: 960,
        content,
      });
      dispatch({ type: "setData", data: { content } });
      onApplied();
    } catch (error) {
      onApplied(error instanceof Error ? error.message : "组件修改不符合原型约束。");
    }
  }, [request, pageId, appState.data.content, dispatch, onApplied]);
  return null;
}

function SourceEditor({
  design, selectedId, disabled, onApply,
}: {
  design: PrototypeDesign;
  selectedId?: string;
  disabled: boolean;
  onApply: (design: PrototypeDesign) => void;
}) {
  const { appState } = usePuck();
  const liveSource = JSON.stringify({
    ...design, content: appState.data.content as DesignBlock[],
  }, null, 2);
  const [source, setSource] = useState(liveSource);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const lastLocatedId = useRef<string>("");
  useEffect(() => {
    if (!dirty) setSource(liveSource);
  }, [dirty, liveSource]);
  useEffect(() => {
    if (!selectedId || lastLocatedId.current === selectedId) return;
    lastLocatedId.current = selectedId;
    const marker = `"id": "${selectedId}"`;
    const start = source.indexOf(marker);
    if (start < 0) return;
    const frame = requestAnimationFrame(() => {
      const area = editor.current;
      if (!area) return;
      area.focus({ preventScroll: true });
      area.setSelectionRange(start, start + marker.length);
      area.scrollTop = Math.max(0, source.slice(0, start).split("\n").length * 19 - area.clientHeight / 3);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, source]);
  function apply() {
    try {
      const parsed = JSON.parse(source) as PrototypeDesign;
      if (parsed.engine !== "puck" || parsed.version !== 1 ||
        ![390, 960].includes(parsed.width) || !Array.isArray(parsed.content))
        throw new Error("代码必须保留 engine、version、width 和 content 字段");
      validateDesign(parsed);
      setDirty(false);
      setError("");
      onApply(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "原型代码格式无效");
    }
  }
  return <section className={s.sourcePane} aria-label="原型代码编辑器">
    <header><div><strong>prototype.json</strong><small>
      {selectedId ? `已定位 ${selectedId}` : "点击画布组件以定位代码"}
    </small></div><div>
      <button disabled={!dirty} onClick={() => { setSource(liveSource); setDirty(false); setError(""); }}>还原</button>
      <button disabled={disabled || !dirty} onClick={apply}>应用代码</button>
    </div></header>
    <textarea ref={editor} value={source} disabled={disabled} spellCheck={false}
      onChange={(event) => { setSource(event.target.value); setDirty(true); setError(""); }}
      aria-label="结构化原型 JSON" />
    {error && <p role="alert">{error}</p>}
  </section>;
}

export default function Designer({
  page, pages, disabled, onChange, onSelection = () => {},
  componentPatch, onPatchApplied = () => {},
}: DesignerProps) {
  const [initial] = useState(() => pageDesign(page));
  const [data, setData] = useState(initial);
  const [revision, setRevision] = useState(0);
  const [width, setWidth] = useState<960 | 390>(initial.width);
  const [mode, setMode] = useState<"design" | "code">("design");
  const [inspectorPanel, setInspectorPanel] = useState<"fields" | "outline">("fields");
  const [paletteVisible, setPaletteVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [selection, setSelection] = useState<PrototypeSelection | null>(null);
  const [error, setError] = useState("");
  const latest = useRef(initial);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!disabled && !page.design) onChangeRef.current(initial);
  }, [disabled, initial, page.design]);
  const pageOptions = JSON.stringify(pages.map(({ id, title }) => ({ id, title })));
  const config = useMemo(() => designerConfig(JSON.parse(pageOptions)), [pageOptions]);
  const publish = useCallback((next: PrototypeDesign, remount = false) => {
    try { validateDesign(next); setError(""); }
    catch (err) { setError((err as Error).message); }
    if (JSON.stringify(next) === JSON.stringify(latest.current)) return;
    latest.current = next;
    setData(next);
    setWidth(next.width);
    onChangeRef.current(next);
    if (remount) setRevision((value) => value + 1);
  }, []);
  const handleSelection = useCallback((next: PrototypeSelection | null) => {
    setSelection(next);
    if (next) { setInspectorVisible(true); setInspectorPanel("fields"); }
    onSelection(next);
  }, [onSelection]);
  const columns = mode === "code"
    ? `minmax(280px, .9fr) minmax(360px, 1.2fr)${inspectorVisible ? " minmax(240px, 280px)" : ""}`
    : `${paletteVisible ? "220px " : ""}minmax(360px, 1fr)${inspectorVisible ? " minmax(240px, 280px)" : ""}`;
  return <div className={s.designer} aria-label="拖拽原型设计器" inert={disabled}>
    {error && <p role="alert">{error}；请修正后再保存和截图。</p>}
    <Puck key={revision} config={config} data={{ content: data.content, root: {} }}
      iframe={{ enabled: false }}
      onChange={(value) => publish({
        engine: "puck", version: 1, width, content: value.content as DesignBlock[],
      })}
      dictionary={{
        "action-delete": "删除", "action-duplicate": "复制", "action-selectparent": "选择父级",
        "label-page": "页面", "label-component": "组件", "outline-empty": "暂无组件",
        "outline-header-title": "图层", "drawer-category-other": "其他", "field-readonly": "只读",
        "plugin-blocks": "组件", "plugin-outline": "图层", "plugin-fields": "属性",
        "plugin-components": "组件", "header-undo": "撤销", "header-redo": "重做",
      }}>
      <SelectionBridge pageId={page.id} pageTitle={page.title} onSelection={handleSelection} />
      <ComponentPatchBridge request={componentPatch} pageId={page.id} onApplied={onPatchApplied} />
      <div className={s.toolbar}>
        <div className={s.modeSwitch} aria-label="原型编辑模式">
          <button aria-pressed={mode === "design"} onClick={() => setMode("design")}>设计</button>
          <button aria-pressed={mode === "code"} onClick={() => setMode("code")}>代码</button>
        </div>
        <div className={s.panelToggles}>
          {mode === "design" && <button aria-pressed={paletteVisible}
            onClick={() => setPaletteVisible((value) => !value)}>组件库</button>}
          <button aria-pressed={inspectorVisible}
            onClick={() => setInspectorVisible((value) => !value)}>属性面板</button>
        </div>
        <div className={s.toolbarActions}><HistoryButtons />
          <select aria-label="原型画布尺寸" value={width}
            onChange={(event) => {
              const next = Number(event.target.value) as 960 | 390;
              setWidth(next); publish({ ...latest.current, width: next });
            }}>
            <option value={960}>桌面 · 960px</option><option value={390}>手机 · 390px</option>
          </select>
        </div>
      </div>
      <div className={s.body} style={{ gridTemplateColumns: columns } as CSSProperties}>
        {mode === "design" && paletteVisible && <aside className={s.palette} aria-label="网页组件库">
          <header><span>组件</span><button aria-label="隐藏组件库"
            onClick={() => setPaletteVisible(false)}>×</button></header>
          <p>拖入画布构建页面；布局组件可以继续嵌套内容。</p><Puck.Components />
        </aside>}
        {mode === "code" && <SourceEditor design={data}
          selectedId={selection?.block.props.id} disabled={disabled}
          onApply={(next) => publish(next, true)} />}
        <main className={s.canvasShell}>
          <header><div><strong>{page.title}</strong><small>
            {selection ? `${selection.block.type} · ${selection.block.props.id}` : "点击组件以编辑属性或定位代码"}
          </small></div><span>{width}px</span></header>
          <div className={s.scroll}><div className={s.canvas} style={{ width }}><Puck.Preview /></div></div>
        </main>
        {inspectorVisible && <aside className={s.inspector} aria-label="组件属性与页面图层">
          <header><div>
            <button aria-pressed={inspectorPanel === "fields"}
              onClick={() => setInspectorPanel("fields")}>属性</button>
            <button aria-pressed={inspectorPanel === "outline"}
              onClick={() => setInspectorPanel("outline")}>图层</button>
          </div><button aria-label="隐藏属性面板" onClick={() => setInspectorVisible(false)}>×</button></header>
          {inspectorPanel === "fields" ? selection ? <>
            <div className={s.selectionSummary}>
              <strong>{selection.block.props.label || selection.block.type}</strong>
              <code>{selection.block.props.id}</code>
            </div>
            <Puck.Fields />
          </> : <p className={s.inspectorEmpty}>在画布中选择组件后编辑属性。</p>
            : <Puck.Outline />}
        </aside>}
      </div>
    </Puck>
  </div>;
}
