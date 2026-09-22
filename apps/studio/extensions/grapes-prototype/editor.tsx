"use client";

import { useEffect, useRef, useState } from "react";
import grapesjs, { type Editor } from "grapesjs";
import webpagePreset from "grapesjs-preset-webpage";
import basicBlocks from "grapesjs-blocks-basic";
import formBlocks from "grapesjs-plugin-forms";
import exportZip from "grapesjs-plugin-export";
import styleBackground from "grapesjs-style-bg";
import postCssParser from "grapesjs-parser-postcss";
import tooltip from "grapesjs-tooltip";
import "grapesjs/dist/css/grapes.min.css";
import type { ResourceEditorProps, ResourcePayload } from "@/lib/plugin-sdk/types";
import { capture } from "./capture";
import { installBlocks } from "./blocks";
import s from "./editor.module.css";

type PageSnapshot = { id: string; title: string; description: string; screenshot: string };
type Payload = ResourcePayload & { title: string; description: string; projectJson: string; screenshot: string; screenshotProjectDigest: string; pageSnapshots?: PageSnapshot[]; confirmed: boolean };
type PageInfo = { id: string; name: string; description: string };
const MAX_PAGES = 4; // The shared PRD prototype artifact currently accepts four pages.

function pagesOf(instance: Editor): PageInfo[] {
  return instance.Pages.getAll().map((page) => ({ id: page.getId(), name: page.getName() || "未命名页面", description: String(page.get("description") || "") }));
}
function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function pageCode(instance: Editor) {
  const component = instance.Pages.getSelected()?.getMainComponent();
  return { html: instance.getHtml({ component }), css: instance.getCss({ component }) || "" };
}

export default function GrapesPrototypeEditor({ resource, disabled, onChange, onSave, onPublish, onError }: ResourceEditorProps) {
  const canvasMount = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const payload = useRef(resource.payload as Payload);
  const change = useRef(onChange);
  payload.current = resource.payload as Payload; change.current = onChange;
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [device, setDevice] = useState("桌面");
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [selectedPage, setSelectedPage] = useState("");

  useEffect(() => {
    if (!canvasMount.current) return;
    let active = true;
    let loading = true;
    const instance = grapesjs.init({
      container: canvasMount.current, height: "700px", width: "auto", storageManager: false,
      fromElement: false, showOffsets: true, selectorManager: { componentFirst: true },
      plugins: [
        postCssParser,
        (current) => webpagePreset(current, { modalImportTitle: "导入网页", textCleanCanvas: "清空当前页面？", showStylesOnChange: true }),
        (current) => basicBlocks(current, { blocks: ["column1", "column2", "column3", "column3-7", "text", "link"], category: "官方基础组件" }),
        (current) => formBlocks(current, { category: "官方表单组件" }),
        exportZip,
        styleBackground,
        tooltip,
      ],
      assetManager: { upload: false, showUrlInput: false, multiUpload: false, embedAsBase64: false,
        uploadFile: async (event) => {
          const files = event.dataTransfer?.files || (event.target as HTMLInputElement | null)?.files;
          for (const file of Array.from(files || [])) await importImage(file);
        } },
      canvas: { styles: [], scripts: [] },
      blockManager: { appendTo: "#gjs-blocks" },
      layerManager: { appendTo: "#gjs-layers" },
      traitManager: { appendTo: "#gjs-traits" },
      styleManager: { appendTo: "#gjs-styles", sectors: [
        { name: "布局与定位", open: true, buildProps: ["display", "flex-direction", "justify-content", "align-items", "gap", "grid-template-columns", "position", "top", "right", "bottom", "left", "z-index"] },
        { name: "尺寸与间距", open: true, buildProps: ["width", "height", "min-width", "min-height", "max-width", "max-height", "margin", "padding"] },
        { name: "文字", open: false, buildProps: ["font-family", "font-size", "font-weight", "color", "text-align", "line-height", "letter-spacing", "text-decoration"] },
        { name: "背景与边框", open: false, buildProps: ["background-color", "opacity", "border", "border-radius", "box-shadow"] },
      ] },
      panels: {
        defaults: [
          { id: "options", appendTo: "#gjs-options" },
          { id: "views", appendTo: "#gjs-right-views" },
        ],
      },
      deviceManager: { devices: [{ name: "Desktop", width: "960px" }, { name: "Tablet", width: "768px" }, { name: "Mobile portrait", width: "390px" }] },
    });
    editor.current = instance;
    instance.Panels.removeButton("options", "gjs-open-import-webpage");
    instance.Panels.removeButton("options", "clear");
    instance.Commands.add("gjs-open-import-webpage", () => setProblem("当前资源不接受原始 HTML 导入，请使用安全组件设计页面。"));
    instance.Commands.add("core:canvas-clear", () => setProblem("请通过左侧组件重新设计当前页面，原型资源不支持一键清空。"));
    installBlocks(instance);
    const refresh = () => {
      if (!active) return;
      setPages(pagesOf(instance));
      setSelectedPage(instance.Pages.getSelected()?.getId() || "");
    };
    instance.on("component:selected component:deselected page page:add page:remove page:update page:select", refresh);
    instance.on("update", () => {
      if (loading || !active) return;
      refresh();
      const next = JSON.stringify(instance.getProjectData());
      if (next !== payload.current.projectJson) change.current({ ...payload.current, projectJson: next,
        confirmed: false, screenshot: "", screenshotProjectDigest: "", pageSnapshots: [] });
    });
    try { instance.loadProjectData(JSON.parse(payload.current.projectJson)); }
    catch (error) { setProblem(`项目无法载入：${String(error)}`); }
    void instance.onReady(() => { if (active) { loading = false; refresh(); setReady(true); } });
    return () => { active = false; editor.current = null; instance.destroy(); };
  }, [resource.id]);

  function edit(patch: Partial<Payload>) {
    change.current({ ...payload.current, ...patch, confirmed: false, screenshot: "", screenshotProjectDigest: "", pageSnapshots: [] });
  }
  function fail(error: unknown) { setProblem(String(error)); onError(String(error)); }
  async function saveDraft() {
    try {
      const projectJson = editor.current ? JSON.stringify(editor.current.getProjectData()) : payload.current.projectJson;
      const changed = projectJson !== payload.current.projectJson;
      await onSave({ ...payload.current, projectJson, ...(changed ? {
        confirmed: false, screenshot: "", screenshotProjectDigest: "", pageSnapshots: [],
      } : {}) });
    } catch (error) { fail(error); }
  }
  function addPage() {
    const instance = editor.current; if (!instance || pages.length >= MAX_PAGES) return;
    const name = window.prompt("新页面名称", `页面 ${pages.length + 1}`)?.trim();
    if (!name) return;
    const page = instance.Pages.add({ id: crypto.randomUUID().replaceAll("-", "").slice(0, 32), name: name.slice(0, 80) });
    if (page) instance.Pages.select(page);
  }
  function renamePage() {
    const page = editor.current?.Pages.getSelected(); if (!page) return;
    const name = window.prompt("页面名称", page.getName())?.trim(); if (name) page.setName(name.slice(0, 80));
  }
  function removePage() {
    const instance = editor.current; const page = instance?.Pages.getSelected();
    if (!instance || !page || instance.Pages.getAll().length <= 1 || !window.confirm(`删除页面“${page.getName()}”？`)) return;
    instance.Pages.remove(page); instance.Pages.select(instance.Pages.getMain());
  }
  function exportPage() {
    const instance = editor.current; if (!instance) return;
    const output = pageCode(instance);
    const html = `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${payload.current.title.replaceAll("<", "&lt;")}</title><style>${output.css}</style></head><body>${output.html}</body></html>`;
    download(`${instance.Pages.getSelected()?.getName() || "prototype"}.html`, html, "text/html;charset=utf-8");
  }
  function exportProject() { if (editor.current) download(`${payload.current.title}.json`, JSON.stringify(editor.current.getProjectData(), null, 2), "application/json"); }
  async function importImage(file?: File) {
    if (!file || !editor.current) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 45000) { fail("仅支持 45 KB 以内的 PNG、JPEG 或 WebP 图片"); return; }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
      });
      editor.current.AssetManager.add(data);
      setNotice(`已添加图片素材：${file.name}`);
    } catch (error) { fail(error); }
  }
  function openAssets() {
    const instance = editor.current; if (!instance) return;
    instance.AssetManager.open({ select(asset, complete) {
      const target = instance.getSelected();
      if (target?.is("image")) target.addAttributes({ src: asset.getSrc() });
      else instance.getWrapper()?.append({ type: "image", attributes: { src: asset.getSrc(), alt: "原型图片" } });
      if (complete) instance.AssetManager.close();
    } });
  }
  async function confirm() {
    const instance = editor.current;
    if (!instance || !ready) { fail("画布尚未准备好"); return; }
    if (!payload.current.description.trim()) { fail("请先填写页面与交互说明"); return; }
    setBusy(true); setProblem("");
    const original = instance.Pages.getSelected();
    try {
      const projectJson = JSON.stringify(instance.getProjectData());
      const snapshots: PageSnapshot[] = [];
      instance.select(undefined);
      for (const page of instance.Pages.getAll()) {
        instance.Pages.select(page);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        snapshots.push({ id: page.getId(), title: page.getName() || payload.current.title,
          description: String(page.get("description") || payload.current.description), screenshot: await capture(instance, Math.floor(130000 / instance.Pages.getAll().length)) });
      }
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectJson));
      const screenshotProjectDigest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const saved = await onSave({ ...payload.current, projectJson, screenshot: snapshots[0]?.screenshot || "", pageSnapshots: snapshots, screenshotProjectDigest, confirmed: true });
      await onPublish(saved);
      setNotice(`已发布 r${saved.revision} 的 ${snapshots.length} 页设计快照，可在交接面板选择 PRD。`);
    } catch (error) { fail(error); }
    finally { if (original && editor.current) editor.current.Pages.select(original); setBusy(false); }
  }
  const currentPage = pages.find((page) => page.id === selectedPage);
  return <section className={s.root} aria-label="自由原型编辑器">
    <div className={s.meta}>
      <label>原型名称<input aria-label="自由原型名称" disabled={disabled || busy} value={String(resource.payload.title)} onChange={(event) => edit({ title: event.target.value })} /></label>
      <label>页面与交互说明<textarea aria-label="自由原型说明" disabled={disabled || busy} value={String(resource.payload.description)} onChange={(event) => edit({ description: event.target.value })} /></label>
      <div className={s.toolbar}>
        <button className={s.iconButton} aria-label="保存草稿" title="保存草稿" disabled={disabled || busy || !ready} onClick={() => void saveDraft()}><span aria-hidden="true">↥</span></button>
        <button className={s.iconButton} aria-label="确认并发布快照" title="确认并发布快照" disabled={disabled || busy || !ready} onClick={() => void confirm()}><span aria-hidden="true">✓</span></button>
        <span className={s.toolbarDivider} aria-hidden="true" />
        <button className={s.iconButton} aria-label="导出当前页 HTML" title="导出当前页 HTML" disabled={!ready} onClick={exportPage}><span aria-hidden="true">&lt;/&gt;</span></button>
        <button className={s.iconButton} aria-label="导出当前页 ZIP" title="导出当前页 ZIP" disabled={!ready} onClick={() => editor.current?.runCommand("gjs-export-zip")}><span aria-hidden="true">⇩</span></button>
        <button className={s.iconButton} aria-label="导出工程 JSON" title="导出工程 JSON" disabled={!ready} onClick={exportProject}><span aria-hidden="true">{"{}"}</span></button>
      </div>
      <div className={s.pagebar} aria-label="原型页面">
        <label>页面<select aria-label="自由原型页面" value={selectedPage} onChange={(event) => editor.current?.Pages.select(event.target.value)}>{pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}</select></label>
        <button className={s.iconButton} aria-label="新建页面" title="新建页面" disabled={disabled || busy || !ready || pages.length >= MAX_PAGES} onClick={addPage}><span aria-hidden="true">＋</span></button>
        <button className={s.iconButton} aria-label="重命名页面" title="重命名页面" disabled={disabled || busy || !ready} onClick={renamePage}><span aria-hidden="true">✎</span></button>
        <button className={s.iconButton} aria-label="删除页面" title="删除页面" disabled={disabled || busy || pages.length <= 1} onClick={removePage}><span aria-hidden="true">⌫</span></button>
        <label>本页交互说明<input aria-label="本页交互说明" disabled={disabled || busy || !ready} value={currentPage?.description || ""} placeholder="留空时使用原型说明" onChange={(event) => editor.current?.Pages.getSelected()?.set("description", event.target.value)} /></label>
      </div>
      {problem && <p role="alert">{problem}</p>}{notice && <p role="status">{notice}</p>}
    </div>
    <div className={s.canvas} aria-label="GrapesJS 画布">
      <div className={s.editorLayout}>
        <aside className={s.leftPanel} aria-label="组件与图层"><div id="gjs-blocks" /><div id="gjs-layers" /></aside>
        <main className={s.stage}><div className={s.gjsTopbar} id="gjs-options" /><div ref={canvasMount} className={s.gjsCanvas} /></main>
        <aside className={s.rightPanel} aria-label="组件属性"><div id="gjs-right-views" /><div id="gjs-traits" /><div id="gjs-styles" /></aside>
      </div>
    </div>
  </section>;
}
