"use client";

import { useEffect, useRef, useState } from "react";
import grapesjs, { type Editor } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import type { ResourceEditorProps, ResourcePayload } from "@/lib/plugin-sdk/types";
import { capture } from "./capture";
import { installBlocks } from "./blocks";
import s from "./editor.module.css";

type Payload = ResourcePayload & { title: string; description: string; projectJson: string; screenshot: string; screenshotProjectDigest: string; confirmed: boolean };

export default function GrapesPrototypeEditor({ resource, disabled, onChange, onSave, onPublish, onError }: ResourceEditorProps) {
  const mount = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const payload = useRef(resource.payload as Payload);
  const change = useRef(onChange);
  payload.current = resource.payload as Payload; change.current = onChange;
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [width, setWidth] = useState("960px");
  const [hasSelection, setHasSelection] = useState(false);

  useEffect(() => {
    if (!mount.current) return;
    let active = true;
    let loading = true;
    const instance = grapesjs.init({
      container: mount.current, height: "600px", width: "auto", storageManager: false,
      fromElement: false, showOffsets: true, selectorManager: { componentFirst: true },
      panels: { defaults: [] },
      blockManager: { appendTo: `#grapes-blocks-${resource.id}` },
      layerManager: { appendTo: `#grapes-layers-${resource.id}` },
      traitManager: { appendTo: `#grapes-traits-${resource.id}` },
      canvas: { styles: [], scripts: [] },
      deviceManager: { devices: [{ name: "桌面", width: "960px" }, { name: "手机", width: "390px" }] },
      styleManager: { appendTo: `#grapes-styles-${resource.id}`, sectors: [
        { name: "自由定位与尺寸", open: true, buildProps: ["display", "position", "top", "right", "bottom", "left", "z-index", "width", "height", "min-width", "min-height", "margin", "padding"] },
        { name: "文字", open: false, buildProps: ["font-family", "font-size", "font-weight", "color", "text-align", "line-height"] },
        { name: "背景与边框", open: false, buildProps: ["background-color", "border", "border-radius", "box-shadow"] },
      ] },
    });
    editor.current = instance;
    installBlocks(instance);
    instance.on("component:selected", () => setHasSelection(Boolean(instance.getSelected())));
    instance.on("component:deselected", () => setHasSelection(Boolean(instance.getSelected())));
    instance.on("update", () => {
      if (loading || !active) return;
      const next = JSON.stringify(instance.getProjectData());
      if (next !== payload.current.projectJson) change.current({ ...payload.current, projectJson: next,
        confirmed: false, screenshot: "", screenshotProjectDigest: "" });
    });
    try { instance.loadProjectData(JSON.parse(payload.current.projectJson)); }
    catch (error) { setProblem(`项目无法载入：${String(error)}`); }
    void instance.onReady(() => { if (active) { loading = false; setReady(true); } });
    return () => { active = false; editor.current = null; instance.destroy(); };
  }, [resource.id]);

  function edit(patch: Partial<Payload>) {
    change.current({ ...payload.current, ...patch, confirmed: false, screenshot: "", screenshotProjectDigest: "" });
  }
  async function saveDraft() {
    try {
      const projectJson = editor.current ? JSON.stringify(editor.current.getProjectData()) : payload.current.projectJson;
      const changed = projectJson !== payload.current.projectJson;
      await onSave({ ...payload.current, projectJson, ...(changed ? {
        confirmed: false, screenshot: "", screenshotProjectDigest: "",
      } : {}) });
    } catch (error) { setProblem(String(error)); onError(String(error)); }
  }
  function clearCanvas() {
    if (!editor.current || !window.confirm("清空当前原型的全部画布组件和样式？名称与说明会保留，已确认截图将失效。")) return;
    editor.current.getWrapper()?.components().reset();
    editor.current.Css.getAll().reset();
    const projectJson = JSON.stringify(editor.current.getProjectData());
    change.current({ ...payload.current, projectJson, confirmed: false, screenshot: "", screenshotProjectDigest: "" });
    setHasSelection(false);
    setNotice("画布已清空，请保存草稿。");
  }
  async function confirm() {
    if (!editor.current || !ready) throw new Error("画布尚未准备好");
    const current = payload.current;
    if (!current.description.trim()) throw new Error("请先填写页面与交互说明");
    setBusy(true); setProblem("");
    try {
      const projectJson = JSON.stringify(editor.current.getProjectData());
      editor.current.select(undefined);
      const screenshot = await capture(editor.current);
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectJson));
      const screenshotProjectDigest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const saved = await onSave({ ...payload.current, projectJson, screenshot, screenshotProjectDigest, confirmed: true });
      await onPublish(saved);
      setNotice(`已发布 r${saved.revision} 的设计快照，可在交接面板选择 PRD。`);
    } catch (error) { setProblem(String(error)); onError(String(error)); }
    finally { setBusy(false); }
  }
  return <section className={s.root} aria-label="自由原型编辑器">
    <div className={s.meta}>
      <label>原型名称<input aria-label="自由原型名称" disabled={disabled || busy} value={String(resource.payload.title)} onChange={(event) => edit({ title: event.target.value })} /></label>
      <label>页面与交互说明<textarea aria-label="自由原型说明" disabled={disabled || busy} value={String(resource.payload.description)} onChange={(event) => edit({ description: event.target.value })} /></label>
      <p>点击组件插入画布，再编辑文字、尺寸和自由定位；当前试验支持单页设计。</p>
      <div className={s.actions}>
        <button disabled={disabled || busy || !ready} onClick={() => void saveDraft()}>保存草稿</button>
        <button disabled={disabled || busy || !ready} onClick={clearCanvas}>一键清空画布</button>
        <button disabled={disabled || busy || !ready} onClick={() => void confirm()}>确认并发布快照</button>
        <button disabled={disabled || busy || !hasSelection} onClick={() => {
          editor.current?.getSelected()?.addStyle({ position: "absolute", left: "40px", top: "40px" });
        }}>自由定位选中组件</button>
        <label>画布宽度<select aria-label="自由原型画布宽度" value={width} onChange={(event) => { setWidth(event.target.value); editor.current?.setDevice(event.target.value === "390px" ? "手机" : "桌面"); }}>
          <option value="960px">桌面 960px</option><option value="390px">手机 390px</option>
        </select></label>
      </div>
      {problem && <p role="alert">{problem}</p>}{notice && <p role="status">{notice}</p>}
    </div>
    <div className={s.workspace}>
      <aside className={s.palette} aria-label="自由原型组件库"><h3>组件库</h3><div id={`grapes-blocks-${resource.id}`} /></aside>
      <div ref={mount} className={s.canvas} aria-label="GrapesJS 画布" />
      <aside className={s.inspector} aria-label="自由原型属性"><h3>图层</h3><div id={`grapes-layers-${resource.id}`} />
        <h3>属性</h3><div id={`grapes-traits-${resource.id}`} /><h3>样式与定位</h3><div id={`grapes-styles-${resource.id}`} /></aside>
    </div>
  </section>;
}
