"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { createComponentId, sha256Hex } from "@/lib/browser-crypto";
import { Brief, Prototype, PrototypePage } from "@/lib/prd-api";
import {
  designElements,
  embedPrototype,
  DesignBlock,
  PrototypeSelection,
  PrototypePatchRequest,
  archivePrototype,
  validateDesign,
} from "@/lib/prototype";
import { prototypeDesigner } from "@/extensions/prototype-designer/manifest";
import {
  PrototypeCanvas,
  capturePrototype,
} from "@/components/workbench/prototype-canvas";
import s from "./prototype-editor.module.css";

const Designer = dynamic(prototypeDesigner.load, {
  ssr: false,
  loading: () => <p>正在加载原型设计器…</p>,
});
const DesignPreview = dynamic(
  () => import("@/extensions/prototype-designer/preview"),
  { ssr: false },
);

export function PrototypeEditor({
  content,
  brief,
  onBrief,
  disabled,
  onBusy,
  onImport,
  designerEnabled,
  onOpenExtensions,
  onEmbed,
  onSave,
  onSelection,
  componentPatch,
  onPatchApplied,
  onOpenBrowser,
  standalone = false,
  draftStorageKey,
}: {
  content: string;
  brief: Brief;
  onBrief: (brief: Brief) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onImport: () => void;
  designerEnabled: boolean;
  onOpenExtensions: () => void;
  onEmbed: (content: string, prototype: Prototype) => Promise<void>;
  onSave: (prototype: Prototype) => Promise<void>;
  onSelection: (selection: PrototypeSelection | null) => void;
  componentPatch: PrototypePatchRequest | null;
  onPatchApplied: (error?: string) => void;
  onOpenBrowser?: (pageId?: string) => void;
  standalone?: boolean;
  draftStorageKey?: string;
}) {
  const [selected, setSelected] = useState("");
  const [edit, setEdit] = useState(Boolean(brief.prototype?.pages[0]));
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const actionMenu = useRef<HTMLDetailsElement>(null);
  const prototype = brief.prototype;
  const page =
    prototype?.pages.find((p) => p.id === selected) || prototype?.pages[0];
  const existing = [
    ...content.matchAll(
      /!\[([^\]\n]*)\]\((data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)\)/g,
    ),
  ];
  useEffect(() => {
    const requestedPage = new URLSearchParams(window.location.search).get("page");
    if (requestedPage) setSelected(requestedPage);
  }, []);
  useEffect(() => {
    if (!designerEnabled || disabled || prototype) return;
    const id = createComponentId();
    onBrief({
      ...brief,
      prototype: archivePrototype({
        confirmed: false,
        pages: [
          {
            id,
            title: "新页面",
            description: "",
            elements: [],
            screenshot: "",
            design: { engine: "puck", version: 1, width: 960, content: [] },
          },
        ],
      }),
    });
    setSelected(id);
    setEdit(true);
  }, [brief, designerEnabled, disabled, onBrief, prototype]);
  useEffect(() => {
    onSelection(null);
  }, [onSelection, page?.id]);
  function update(next: Prototype) {
    setFeedback("");
    onBrief({
      ...brief,
      prototype: archivePrototype({
        ...next,
        confirmed: false,
        input_digest: "",
      }),
    });
  }
  function patch(value: Partial<PrototypePage>) {
    if (!prototype || !page || disabled) return;
    update({
      ...prototype,
      pages: prototype.pages.map((p) =>
        p.id === page.id
          ? {
              ...p,
              ...value,
              ...(p.design || p.elements.length ? { screenshot: "" } : {}),
            }
          : p,
      ),
    });
  }
  async function confirm(insert: boolean) {
    if (!prototype || disabled) return;
    setError("");
    onBusy(true);
    try {
      for (const p of prototype.pages) {
        if (!p.title.trim() || !p.description.trim())
          throw new Error("请为每个原型页面填写名称和交互说明");
        if (p.design) {
          validateDesign(p.design);
          if (!designElements(p.design).length)
            throw new Error("请先拖入页面组件，再生成截图");
        }
      }
      const pages: PrototypePage[] = [];
      for (const p of prototype.pages) {
        const screenshot = p.design
          ? await (
              await import("@/extensions/prototype-designer/capture")
            ).captureDesign(p)
          : await capturePrototype(p);
        pages.push({ ...p, screenshot });
      }
      if (pages.reduce((n, p) => n + p.screenshot.length, 0) > 140000)
        throw new Error("截图合计过大，请压缩导入图片或减少页面");
      const { prototype: _prototype, ...values } = brief;
      const canonical = JSON.stringify(
        Object.fromEntries(
          Object.entries(values)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [
              key,
              key === "sources"
                ? brief.sources.map((source) => ({
                    content: source.content.trim(),
                    name: source.name.trim(),
                  }))
                : typeof value === "string"
                  ? value.trim()
                  : value,
            ]),
        ),
      );
      const input_digest = await sha256Hex(canonical);
      const confirmed = archivePrototype({
        pages,
        confirmed: true,
        input_digest,
      });
      const next = insert ? embedPrototype(content, confirmed) : undefined;
      onBrief({ ...brief, prototype: confirmed });
      if (next !== undefined) await onEmbed(next, confirmed);
      setFeedback(
        "原型已确认，截图已准备。通过文件菜单保存，或运行菜单编写 PRD。",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "截图生成失败");
    } finally {
      onBusy(false);
    }
  }
  function removePage() {
    if (!prototype || !page) return;
    function clean(blocks: DesignBlock[]): DesignBlock[] {
      return blocks.map((b) => ({
        ...b,
        props: {
          ...b.props,
          target: b.props.target === page!.id ? "" : b.props.target,
          left: clean(b.props.left),
          right: clean(b.props.right),
        },
      }));
    }
    const pages = prototype.pages
      .filter((p) => p.id !== page.id)
      .map((p) => {
        const design = p.design
          ? { ...p.design, content: clean(p.design.content) }
          : p.design;
        return {
          ...p,
          design,
          screenshot: p.elements.length || design ? "" : p.screenshot,
          elements: design
            ? designElements(design)
            : p.elements.map((e) =>
                e.target === page.id ? { ...e, target: "" } : e,
              ),
        };
      });
    onBrief({
      ...brief,
      prototype: pages.length ? { pages, confirmed: false } : null,
    });
  }
  function addPage() {
    if (disabled || !designerEnabled || (prototype?.pages.length || 0) >= 4) return;
    const id = createComponentId();
    update({
      confirmed: false,
      pages: [
        ...(prototype?.pages || []),
        {
          id, title: "新页面", description: "", elements: [], screenshot: "",
          design: { engine: "puck", version: 1, width: 960, content: [] },
        },
      ],
    });
    setSelected(id);
    setEdit(true);
  }
  function importEmbeddedImages() {
    if (existing.length > 4 || existing.reduce((n, p) => n + p[2].length, 0) > 140000) {
      setError("已有原型图超过 4 页或图片过大，请精简后重新导入");
      return;
    }
    update({
      confirmed: false,
      pages: existing.map((match, index) => ({
        id: `imported-${index + 1}`,
        title: match[1].slice(0, 80) || `页面 ${index + 1}`,
        description: "", elements: [], screenshot: match[2],
      })),
    });
    actionMenu.current?.removeAttribute("open");
  }
  return (
    <section className={`${s.editor} ${standalone ? s.standalone : ""}`} aria-label="原型设计">
      <div className={s.compactToolbar}>
        <div className={s.pagePicker}>
          <label htmlFor="prototype-page-picker">页面</label>
          <select id="prototype-page-picker" value={page?.id || ""}
            disabled={!prototype?.pages.length}
            onChange={(event) => { setSelected(event.target.value); setFeedback(""); }}>
            {!page && <option value="">暂无页面</option>}
            {prototype?.pages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          <button disabled={disabled || !designerEnabled || (prototype?.pages.length || 0) >= 4}
            onClick={addPage} aria-label="添加原型页面" title="添加页面">＋</button>
        </div>
        <div className={s.toolbarEnd}>
          {page && <button className={s.prototypeState}
            aria-label={edit ? "预览" : "继续编辑"}
            title={edit ? "预览" : "继续编辑"}
            disabled={disabled}
            onClick={() => setEdit((value) => !value)}>
            {edit ? "预览" : "继续编辑"}
          </button>}
          {!standalone && onOpenBrowser && <button className={s.openBrowser}
            disabled={disabled} onClick={() => onOpenBrowser(page?.id)}>
            在浏览器打开 ↗
          </button>}
          <details ref={actionMenu} className={s.actionMenu}>
            <summary aria-label="原型操作">⋯</summary>
            <div className={s.actionDropdown}>
              {prototype && <button disabled={disabled} onClick={() => {
                actionMenu.current?.removeAttribute("open");
                void onSave(archivePrototype(prototype));
              }}>保存设计方案</button>}
              <button disabled={disabled} onClick={() => {
                actionMenu.current?.removeAttribute("open"); onImport();
              }}>导入原型图</button>
              {page && !prototype?.confirmed && <button disabled={disabled} onClick={() => {
                actionMenu.current?.removeAttribute("open"); void confirm(false);
              }}>确认原型并生成截图</button>}
              {page && <button disabled={disabled} onClick={() => {
                actionMenu.current?.removeAttribute("open"); void confirm(true);
              }}>确认并交给 PRD 编写</button>}
              {!prototype && existing.length > 0 && <button disabled={disabled}
                onClick={importEmbeddedImages}>纳入正文中的 {existing.length} 张配图</button>}
              {page && edit && <button disabled={disabled} onClick={() => {
                actionMenu.current?.removeAttribute("open"); removePage();
              }}>删除当前页面</button>}
              {prototype?.document && <details className={s.archive}>
                <summary>原型设计方案文档</summary>
                <pre>{prototype.document}</pre>
              </details>}
            </div>
          </details>
        </div>
      </div>
      {!designerEnabled && (
        <p>
          原型设计器插件未启用。
          <button onClick={onOpenExtensions}>管理插件</button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {!page && (
        <p className={s.empty}>
          添加页面开始拖拽设计；要让 AI 生成原型，请使用右侧对话，也可以导入已有原型图。
        </p>
      )}
      {page && prototype && (
        <>
          {edit ? (
            <>
              {designerEnabled && (page.design || page.elements.length > 0) ? (
                <Designer
                  key={page.id}
                  draftStorageKey={draftStorageKey ? `${draftStorageKey}:${page.id}` : undefined}
                  page={page}
                  pages={prototype.pages}
                  disabled={disabled}
                  onChange={(design) =>
                    patch({ design, elements: designElements(design) })
                  }
                  onPageChange={patch}
                  onSelection={onSelection}
                  componentPatch={componentPatch}
                  onPatchApplied={onPatchApplied}
                />
              ) : (
                <div className={s.canvas}>
                  {page.screenshot ? (
                    <img src={page.screenshot} alt={page.title} />
                  ) : (
                    <PrototypeCanvas page={page} />
                  )}
                </div>
              )}
              {!page.design && !page.elements.length && (
                <p>导入图片保留为静态原型；添加页面可进行拖拽设计。</p>
              )}
              {(!designerEnabled || (!page.design && !page.elements.length)) && (
                <details className={s.pageActions}>
                  <summary>页面信息</summary>
                  <fieldset disabled={disabled} className={s.fields}>
                    <label>页面名称
                      <input value={page.title} maxLength={80}
                        onChange={(event) => patch({ title: event.target.value })} />
                    </label>
                    <label>页面与交互说明
                      <textarea value={page.description} maxLength={2000} rows={5}
                        placeholder="说明角色、操作、跳转以及异常状态；截图时会一同嵌入 PRD。"
                        onChange={(event) => patch({ description: event.target.value })} />
                    </label>
                  </fieldset>
                </details>
              )}
            </>
          ) : (
            <>
              {page.design ? (
                <DesignPreview
                  page={page}
                  pages={prototype.pages}
                  onNavigate={setSelected}
                />
              ) : (
                <div className={s.canvas}>
                  {page.elements.length ? (
                    <PrototypeCanvas
                      page={page}
                      onNavigate={setSelected}
                      onAction={setFeedback}
                    />
                  ) : (
                    <img src={page.screenshot} alt={page.title} />
                  )}
                </div>
              )}
              <details className={s.pageActions}>
                <summary>页面与交互说明</summary>
                <p className={s.description}>
                  {page.description || "请编辑页面，补充操作、状态与异常说明。"}
                </p>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
