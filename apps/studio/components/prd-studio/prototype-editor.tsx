"use client";

import { useState } from "react";
import { Brief, Prototype, PrototypePage } from "@/lib/prd-api";
import {
  PrototypeCanvas,
  capturePrototype,
} from "@/components/workbench/prototype-canvas";
import s from "./prototype-editor.module.css";

export function PrototypeEditor({
  content,
  brief,
  onBrief,
  disabled,
  onBusy,
  onGenerate,
  onImport,
}: {
  content: string;
  brief: Brief;
  onBrief: (brief: Brief) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onGenerate: (instruction: string) => void;
  onImport: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [instruction, setInstruction] = useState("");
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const prototype = brief.prototype;
  const existing = [
    ...content.matchAll(
      /!\[([^\]\n]*)\]\((data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)\)/g,
    ),
  ];
  const page =
    prototype?.pages.find((p) => p.id === selected) || prototype?.pages[0];
  function update(next: Prototype) {
    onBrief({ ...brief, prototype: { ...next, confirmed: false } });
  }
  function patch(value: Partial<PrototypePage>) {
    if (!prototype || !page) return;
    update({
      ...prototype,
      pages: prototype.pages.map((p) =>
        p.id === page.id
          ? { ...p, ...value, ...(p.elements.length ? { screenshot: "" } : {}) }
          : p,
      ),
    });
  }
  async function confirm() {
    if (!prototype || disabled) return;
    setError("");
    onBusy(true);
    try {
      if (
        prototype.pages.some(
          (p) =>
            !p.title.trim() ||
            !p.description.trim() ||
            p.elements.some((e) => !e.label.trim()),
        )
      )
        throw new Error("请为每个原型页面填写名称和交互说明");
      const pages = [];
      for (const p of prototype.pages)
        pages.push({ ...p, screenshot: await capturePrototype(p) });
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
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical),
      );
      const input_digest = Array.from(new Uint8Array(bytes), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
      onBrief({
        ...brief,
        prototype: { pages, confirmed: true, input_digest },
      });
      setFeedback(
        "原型已确认，截图已准备。使用文件菜单保存，或通过运行菜单编写 PRD。",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "截图生成失败");
    } finally {
      onBusy(false);
    }
  }
  return (
    <section className={s.editor} aria-label="原型设计">
      <header>
        <div>
          <h1>原型设计</h1>
          <p>预览页面与跳转，确认后将截图和说明写入 PRD。</p>
        </div>
        <span>{prototype?.confirmed ? "✓ 已确认" : "待确认"}</span>
      </header>
      <div className={s.actions}>
        <button disabled={disabled} onClick={onImport}>
          导入原型图
        </button>
        <button
          disabled={disabled}
          onClick={() => {
            const id = `page${Date.now()}`;
            update({
              confirmed: false,
              pages: [
                ...(prototype?.pages || []),
                {
                  id,
                  title: "新页面",
                  description: "",
                  elements: [
                    { kind: "text", label: "页面内容", detail: "", target: "" },
                  ],
                  screenshot: "",
                },
              ],
            });
            setSelected(id);
            setEdit(true);
          }}
          hidden={(prototype?.pages.length || 0) >= 4}
        >
          添加页面
        </button>
        {page && (
          <>
            <button disabled={disabled} onClick={() => setEdit(!edit)}>
              {edit ? "预览原型" : "编辑页面"}
            </button>
            <button
              hidden={prototype?.confirmed}
              disabled={disabled || Boolean(prototype?.confirmed)}
              onClick={() => void confirm()}
            >
              确认原型并生成截图
            </button>
          </>
        )}
      </div>
      <details className={s.generate} open={!prototype}>
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
          {prototype ? "根据要求重新设计" : "根据简报生成原型"}
        </button>
        {prototype && (
          <small>重新设计将替换当前原型；已保存的版本可从版本历史恢复。</small>
        )}
      </details>
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
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
              pages: existing.map((match, index) => ({
                id: `imported-${index + 1}`,
                title: match[1].slice(0, 80) || `页面 ${index + 1}`,
                description: "",
                elements: [],
                screenshot: match[2],
              })),
            });
            setEdit(true);
          }}
        >
          将正文中的 {existing.length} 张配图纳入原型设计
        </button>
      )}
      {!page && (
        <p className={s.empty}>
          先填写需求简报，再让 AI 设计关键页面，或导入已有原型图。
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
                  rows={4}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </label>
              {page.elements.map((element, index) => (
                <div className={s.element} key={index}>
                  <select
                    aria-label={`组件 ${index + 1} 类型`}
                    value={element.kind}
                    onChange={(e) =>
                      patch({
                        elements: page.elements.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                kind: e.target.value as typeof v.kind,
                                target: "",
                              }
                            : v,
                        ),
                      })
                    }
                  >
                    {["text", "input", "button", "list", "card"].map(
                      (kind, i) => (
                        <option value={kind} key={kind}>
                          {["文字", "输入框", "按钮", "列表", "卡片"][i]}
                        </option>
                      ),
                    )}
                  </select>
                  <input
                    aria-label={`组件 ${index + 1} 名称`}
                    value={element.label}
                    maxLength={80}
                    onChange={(e) =>
                      patch({
                        elements: page.elements.map((v, i) =>
                          i === index ? { ...v, label: e.target.value } : v,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`组件 ${index + 1} 说明`}
                    value={element.detail}
                    maxLength={200}
                    onChange={(e) =>
                      patch({
                        elements: page.elements.map((v, i) =>
                          i === index ? { ...v, detail: e.target.value } : v,
                        ),
                      })
                    }
                  />
                  {element.kind === "button" && (
                    <select
                      aria-label={`组件 ${index + 1} 跳转`}
                      value={element.target}
                      onChange={(e) =>
                        patch({
                          elements: page.elements.map((v, i) =>
                            i === index ? { ...v, target: e.target.value } : v,
                          ),
                        })
                      }
                    >
                      <option value="">留在当前页并显示说明</option>
                      {prototype.pages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    aria-label={`移除组件 ${index + 1}`}
                    disabled={page.elements.length === 1}
                    onClick={() =>
                      patch({
                        elements: page.elements.filter((_, i) => i !== index),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {page.elements.length > 0 && page.elements.length < 8 && (
                <button
                  onClick={() =>
                    patch({
                      elements: [
                        ...page.elements,
                        {
                          kind: "button",
                          label: "新操作",
                          detail: "",
                          target: "",
                        },
                      ],
                    })
                  }
                >
                  添加组件
                </button>
              )}
              <button
                onClick={() => {
                  const pages = prototype.pages
                    .filter((p) => p.id !== page.id)
                    .map((p) => ({
                      ...p,
                      screenshot: p.elements.length ? "" : p.screenshot,
                      elements: p.elements.map((e) =>
                        e.target === page.id ? { ...e, target: "" } : e,
                      ),
                    }));
                  onBrief({
                    ...brief,
                    prototype: pages.length
                      ? { pages, confirmed: false }
                      : null,
                  });
                }}
              >
                删除页面
              </button>
            </fieldset>
          ) : (
            <>
              <div className={s.canvas}>
                {page.elements.length ? (
                  <PrototypeCanvas
                    page={page}
                    onNavigate={(id) => {
                      setSelected(id);
                      setFeedback("");
                    }}
                    onAction={setFeedback}
                  />
                ) : (
                  <img src={page.screenshot} alt={page.title} />
                )}
              </div>
              <p className={s.description}>
                {page.description || "请编辑页面，补充操作、状态与异常说明。"}
              </p>
              {!page.elements.length && (
                <small>
                  导入原型图为静态预览；AI
                  依据你填写的交互说明编写需求，不识别图片像素。
                </small>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
