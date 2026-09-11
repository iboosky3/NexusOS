"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Puck, usePuck } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import { DesignBlock, PrototypeDesign, validateDesign } from "@/lib/prototype";
import { designerConfig, pageDesign } from "./config";
import type { DesignerProps } from "./manifest";
import s from "./editor.module.css";

function HistoryButtons() {
  const { history, appState } = usePuck();
  // Puck groups edits into history asynchronously. Wait for the current edit
  // to be recorded so an immediate undo cannot discard the redo snapshot.
  const settled =
    JSON.stringify(history.histories[history.index]?.state.data) ===
    JSON.stringify(appState.data);
  return (
    <>
      <button
        disabled={!settled || !history.hasPast}
        onClick={history.back}
        title="撤销"
      >
        ↶
      </button>
      <button
        disabled={!settled || !history.hasFuture}
        onClick={history.forward}
        title="重做"
      >
        ↷
      </button>
    </>
  );
}
export default function Designer({
  page,
  pages,
  disabled,
  onChange,
}: DesignerProps) {
  const [initial] = useState(() => pageDesign(page));
  const [width, setWidth] = useState<960 | 390>(initial.width);
  const [panel, setPanel] = useState<"blocks" | "fields" | "outline">("blocks");
  const [error, setError] = useState("");
  const latest = useRef(initial);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!disabled && !page.design) onChangeRef.current(initial);
  }, [disabled, initial, page.design]);
  const widthRef = useRef(width);
  widthRef.current = width;
  const pageOptions = JSON.stringify(
    pages.map(({ id, title }) => ({ id, title })),
  );
  const config = useMemo(
    () => designerConfig(JSON.parse(pageOptions)),
    [pageOptions],
  );
  function change(design: PrototypeDesign) {
    try {
      validateDesign(design);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
    if (JSON.stringify(design) === JSON.stringify(latest.current)) return;
    latest.current = design;
    onChangeRef.current(design);
  }
  return (
    <div className={s.designer} aria-label="拖拽原型设计器" inert={disabled}>
      {error && (
        <p role="alert">{error}；请撤销或精简，修正后才能保存并生成截图。</p>
      )}
      <Puck
        config={config}
        data={{ content: initial.content, root: {} }}
        iframe={{ enabled: false }}
        onChange={(data) =>
          change({
            engine: "puck",
            version: 1,
            width: widthRef.current,
            content: data.content as DesignBlock[],
          })
        }
        dictionary={{
          "action-delete": "删除",
          "action-duplicate": "复制",
          "action-selectparent": "选择父级",
          "label-page": "页面",
          "label-component": "组件",
          "outline-empty": "暂无组件",
          "outline-header-title": "图层",
          "drawer-category-other": "其他",
          "field-readonly": "只读",
          "plugin-blocks": "组件",
          "plugin-outline": "图层",
          "plugin-fields": "属性",
          "plugin-components": "组件",
          "header-undo": "撤销",
          "header-redo": "重做",
        }}
      >
        <div className={s.toolbar}>
          <div>
            {(
              [
                ["blocks", "组件"],
                ["fields", "属性"],
                ["outline", "图层"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={panel === id}
                onClick={() => setPanel(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div>
            <HistoryButtons />
            <select
              aria-label="原型画布尺寸"
              value={width}
              onChange={(e) => {
                const next = Number(e.target.value) as 960 | 390;
                setWidth(next);
                change({ ...latest.current, width: next });
              }}
            >
              <option value={960}>桌面 · 960px</option>
              <option value={390}>手机 · 390px</option>
            </select>
          </div>
        </div>
        <div className={s.body}>
          <aside className={s.tools} aria-label="原型组件与属性">
            <section aria-label="网页组件库" className={s.palette}>
              <h2>网页组件</h2>
              <p>
                拖动组件到画布；并排排列时先拖入“横向布局”。选中后切换“属性”调整尺寸和样式。
              </p>
              <Puck.Components />
            </section>
            {panel !== "blocks" && (
              <section
                className={s.inspector}
                aria-label={panel === "fields" ? "组件属性" : "页面图层"}
              >
                <h2>{panel === "fields" ? "组件属性" : "页面图层"}</h2>
                {panel === "fields" ? <Puck.Fields /> : <Puck.Outline />}
              </section>
            )}
          </aside>
          <div className={s.scroll}>
            <div className={s.canvas} style={{ width }}>
              <Puck.Preview />
            </div>
          </div>
        </div>
      </Puck>
    </div>
  );
}
