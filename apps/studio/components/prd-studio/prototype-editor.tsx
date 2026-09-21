"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createComponentId, sha256Hex } from "@/lib/browser-crypto";
import { Brief, Prototype, PrototypePage } from "@/lib/prd-api";
import {
  designElements,
  embedPrototype,
  DesignBlock,
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
  onGenerate,
  onImport,
  designerEnabled,
  onOpenExtensions,
  onEmbed,
  onSave,
}: {
  content: string;
  brief: Brief;
  onBrief: (brief: Brief) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onGenerate: (instruction: string) => void;
  onImport: () => void;
  designerEnabled: boolean;
  onOpenExtensions: () => void;
  onEmbed: (content: string) => void;
  onSave: (prototype: Prototype) => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const [instruction, setInstruction] = useState("");
  const [edit, setEdit] = useState(Boolean(brief.prototype?.pages[0]));
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const prototype = brief.prototype;
  const page =
    prototype?.pages.find((p) => p.id === selected) || prototype?.pages[0];
  const hasPrototypeContent = Boolean(
    prototype?.pages.some(
      (item) =>
        item.screenshot || item.elements.length || item.design?.content.length,
    ),
  );
  const existing = [
    ...content.matchAll(
      /!\[([^\]\n]*)\]\((data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)\)/g,
    ),
  ];
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
      if (next !== undefined) onEmbed(next);
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
  return (
    <section className={s.editor} aria-label="原型设计">
      <header>
        <div>
          <h1>原型设计</h1>
          <p>拖拽设计 → 预览交互 → 截图嵌入 PRD</p>
        </div>
        <div className={s.confirmation}>
          <span>{prototype?.confirmed ? "✓ 已确认" : "待确认"}</span>
          {page && !prototype?.confirmed && (
            <button
              className={s.primaryAction}
              disabled={disabled}
              onClick={() => void confirm(false)}
            >
              确认原型并生成截图
            </button>
          )}
        </div>
      </header>
      <div className={s.actions}>
        {prototype && (
          <button
            disabled={disabled}
            onClick={() => void onSave(archivePrototype(prototype))}
          >
            保存设计方案
          </button>
        )}
        <button disabled={disabled} onClick={onImport}>
          导入原型图
        </button>
        <button
          disabled={disabled || !designerEnabled}
          hidden={(prototype?.pages.length || 0) >= 4}
          onClick={() => {
            const id = createComponentId();
            update({
              confirmed: false,
              pages: [
                ...(prototype?.pages || []),
                {
                  id,
                  title: "新页面",
                  description: "",
                  elements: [],
                  screenshot: "",
                  design: {
                    engine: "puck",
                    version: 1,
                    width: 960,
                    content: [],
                  },
                },
              ],
            });
            setSelected(id);
            setEdit(true);
          }}
        >
          添加页面
        </button>
        {page && (
          <>
            <button disabled={disabled} onClick={() => setEdit(!edit)}>
              {edit ? "预览原型" : "编辑页面"}
            </button>
            <button disabled={disabled} onClick={() => void confirm(true)}>
              确认并嵌入 PRD
            </button>
          </>
        )}
      </div>
      {!designerEnabled && (
        <p>
          原型设计器插件未启用。
          <button onClick={onOpenExtensions}>管理插件</button>
        </p>
      )}
      <details className={s.generate}>
        <summary>AI 设计原型</summary>
        <textarea
          aria-label="原型设计要求"
          value={instruction}
          maxLength={8000}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={disabled}
          placeholder="补充布局偏好、关键页面或修改要求。留空则根据需求简报设计。"
        />
        <button
          disabled={
            disabled || !brief.title.trim() || !brief.description.trim()
          }
          onClick={() => onGenerate(instruction)}
        >
          {hasPrototypeContent ? "根据要求重新设计" : "根据简报生成原型"}
        </button>
        {prototype && (
          <small>重新设计会替换当前原型；已保存的版本可从版本历史恢复。</small>
        )}
      </details>
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {prototype?.document && (
        <details className={s.archive}>
          <summary>原型设计方案文档</summary>
          <pre>{prototype.document}</pre>
        </details>
      )}
      {!prototype && existing.length > 0 && (
        <button
          disabled={disabled}
          onClick={() => {
            if (
              existing.length > 4 ||
              existing.reduce((n, p) => n + p[2].length, 0) > 140000
            ) {
              setError("已有原型图超过 4 页或图片过大，请精简后重新导入");
              return;
            }
            update({
              confirmed: false,
              pages: existing.map((match, i) => ({
                id: `imported-${i + 1}`,
                title: match[1].slice(0, 80) || `页面 ${i + 1}`,
                description: "",
                elements: [],
                screenshot: match[2],
              })),
            });
          }}
        >
          将正文中的 {existing.length} 张配图纳入原型设计
        </button>
      )}
      {!page && (
        <p className={s.empty}>
          添加页面开始拖拽设计，也可以让 AI 根据简报生成原型，或导入已有原型图。
        </p>
      )}
      {page && prototype && (
        <>
          <nav aria-label="原型页面" className={s.pages}>
            {prototype.pages.map((p) => (
              <button
                key={p.id}
                aria-current={p.id === page.id ? "page" : undefined}
                onClick={() => {
                  setSelected(p.id);
                  setFeedback("");
                }}
              >
                {p.title}
              </button>
            ))}
          </nav>
          {edit ? (
            <>
              <fieldset disabled={disabled} className={s.fields}>
                <label>
                  页面名称
                  <input
                    value={page.title}
                    maxLength={80}
                    onChange={(e) => patch({ title: e.target.value })}
                  />
                </label>
                <label>
                  页面与交互说明
                  <textarea
                    value={page.description}
                    maxLength={2000}
                    rows={2}
                    placeholder="说明角色、操作、跳转以及异常状态；截图时会一同嵌入 PRD。"
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                </label>
              </fieldset>
              {designerEnabled && (page.design || page.elements.length > 0) ? (
                <Designer
                  key={page.id}
                  page={page}
                  pages={prototype.pages}
                  disabled={disabled}
                  onChange={(design) =>
                    patch({ design, elements: designElements(design) })
                  }
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
              <details className={s.pageActions}>
                <summary>页面操作</summary>
                <button disabled={disabled} onClick={removePage}>
                  删除当前页面
                </button>
              </details>
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
              <p className={s.description}>
                {page.description || "请编辑页面，补充操作、状态与异常说明。"}
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
