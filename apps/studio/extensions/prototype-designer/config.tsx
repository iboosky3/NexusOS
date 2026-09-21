import { Config, Fields, Slot } from "@puckeditor/core";
import { createComponentId } from "@/lib/browser-crypto";
import type { CSSProperties } from "react";
import s from "./appearance.module.css";
import type {
  DesignBlock,
  PrototypePage,
  PrototypeDesign,
} from "@/lib/prototype";

export function newBlock(
  type: DesignBlock["type"],
  label: string,
  detail = "",
  target = "",
): DesignBlock {
  return {
    type,
    props: {
      id: createComponentId(),
      label,
      detail,
      target,
      tone: "green",
      left: [],
      right: [],
    },
  };
}
export function pageDesign(page: PrototypePage): PrototypeDesign {
  return (
    page.design || {
      engine: "puck",
      version: 1,
      width: 960,
      content: [
        newBlock("Heading", page.title),
        ...page.elements.map((element) =>
          newBlock(
            (
              {
                text: "Text",
                input: "Input",
                button: "Button",
                list: "List",
                card: "Card",
              } as const
            )[element.kind],
            element.label,
            element.detail,
            element.target,
          ),
        ),
      ],
    }
  );
}
type Props = Omit<DesignBlock["props"], "id" | "left" | "right"> & {
  left: Slot;
  right: Slot;
};
type Blocks = Record<DesignBlock["type"], Props>;
const defaults: Props = {
  label: "",
  detail: "",
  target: "",
  tone: "green",
  left: [],
  right: [],
};
const tones = { green: "#287454", blue: "#315fba", gray: "#596773" };
const blockStyle = { padding: "14px 18px", overflowWrap: "anywhere" as const };
const appearanceDefaults = {
  width: 0,
  height: 0,
  padding: 14,
  margin: 0,
  fontSize: 14,
  radius: 5,
  color: "",
  background: "",
  gap: 12,
  align: "center" as const,
  justify: "start" as const,
  wrap: "wrap" as const,
  ratio: 50,
};
const numberField = (label: string, min: number, max: number) => ({
  type: "number" as const,
  label,
  min,
  max,
});
const sizeFields = {
  width: numberField("宽度 px（0 自动）", 0, 1920),
  height: numberField("高度 px（0 自动）", 0, 2000),
  padding: numberField("内边距 px", 0, 200),
  margin: numberField("外边距 px", 0, 200),
};
const appearanceField = {
  type: "object" as const,
  label: "尺寸与样式",
  objectFields: {
    ...sizeFields,
    fontSize: numberField("字号 px", 8, 120),
    radius: numberField("圆角 px", 0, 200),
    color: { type: "text" as const, label: "文字颜色（#RRGGBB，留空默认）" },
    background: {
      type: "text" as const,
      label: "背景颜色（#RRGGBB，留空默认）",
    },
  },
};
const layoutField = {
  type: "object" as const,
  label: "布局属性",
  objectFields: {
    ...sizeFields,
    gap: numberField("组件间距 px", 0, 200),
    align: {
      type: "select" as const,
      label: "垂直对齐",
      options: [
        { label: "顶部", value: "start" },
        { label: "居中", value: "center" },
        { label: "底部", value: "end" },
        { label: "拉伸", value: "stretch" },
      ],
    },
    justify: {
      type: "select" as const,
      label: "水平对齐",
      options: [
        { label: "靠左", value: "start" },
        { label: "居中", value: "center" },
        { label: "靠右", value: "end" },
        { label: "两端对齐", value: "space-between" },
      ],
    },
    wrap: {
      type: "select" as const,
      label: "自动换行",
      options: [
        { label: "允许换行", value: "wrap" },
        { label: "保持一行", value: "nowrap" },
      ],
    },
  },
};

export function designerConfig(
  pages: PrototypePage[],
  onNavigate?: (id: string) => void,
): Config<Blocks> {
  const fields = {
    appearance: appearanceField,
    label: { type: "text" as const, label: "文字 / 名称" },
    detail: { type: "textarea" as const, label: "说明 / 示例" },
    tone: {
      type: "select" as const,
      label: "主题色",
      options: [
        { label: "森林绿", value: "green" },
        { label: "靛蓝", value: "blue" },
        { label: "中性灰", value: "gray" },
      ],
    },
  };
  const make = (
    label: string,
    render: Config<Blocks>["components"]["Text"]["render"],
    detail = "",
  ) => ({
    label,
    fields: fields as Fields<Props>,
    defaultProps: {
      ...defaults,
      label,
      detail,
      appearance: {
        ...appearanceDefaults,
        fontSize: label === "标题" ? 28 : 14,
      },
    },
    render: (props: Parameters<typeof render>[0]) => {
      const a = props.appearance;
      const style = {
        width: a?.width
          ? a.width +
            (label === "按钮" || label === "输入框"
              ? 2 * ((a.padding ?? 14) + (a.margin ?? 0))
              : 0)
          : undefined,
        "--control-width": a?.width ? `${a.width}px` : undefined,
        "--control-height": a?.height ? `${a.height}px` : undefined,
        "--block-padding": a ? `${a.padding ?? 14}px` : undefined,
        "--block-margin": a ? `${a.margin ?? 0}px` : undefined,
        "--block-radius": a ? `${a.radius ?? 5}px` : undefined,
        "--block-font": a?.fontSize ? `${a.fontSize}px` : undefined,
        "--block-color": a?.color || undefined,
        "--block-background":
          a?.background || (label === "按钮" ? tones[props.tone] : undefined),
        minHeight:
          label !== "按钮" && label !== "输入框"
            ? a?.height || undefined
            : undefined,
        background:
          label !== "按钮" && label !== "输入框"
            ? a?.background || undefined
            : undefined,
      } as CSSProperties;
      return (
        <div className={s.block} style={style}>
          {render(props)}
        </div>
      );
    },
  });
  return {
    root: {
      fields: {},
      render: ({ children }) => (
        <div
          style={{
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            color: "#203a2b",
            background: "#fff",
            minHeight: 600,
            padding: "24px 12px",
            boxSizing: "border-box",
          }}
        >
          {children}
        </div>
      ),
    },
    categories: {
      layout: { title: "布局", components: ["Row", "Columns", "Divider"] },
      basic: {
        title: "页面组件",
        components: ["Heading", "Text", "Input", "Button", "Card", "List"],
      },
    },
    components: {
      Heading: make("标题", ({ label, detail, tone }) => (
        <div style={blockStyle}>
          <h1 style={{ fontSize: 28, color: tones[tone], margin: "0 0 10px" }}>
            {label}
          </h1>
          {detail && <p style={{ fontSize: 14, margin: 0 }}>{detail}</p>}
        </div>
      )),
      Text: make("文字", ({ label, detail }) => (
        <div style={{ ...blockStyle, fontSize: 15, lineHeight: 1.8 }}>
          <strong>{label}</strong>
          <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{detail}</p>
        </div>
      )),
      Input: make("输入框", ({ label, detail }) => (
        <label style={{ ...blockStyle, display: "block", fontSize: 14 }}>
          {label}
          <input
            aria-label={label}
            placeholder={detail || "请输入"}
            style={{
              display: "block",
              boxSizing: "border-box",
              width: "100%",
              padding: 12,
              marginTop: 8,
              background: "#fff",
              border: "1px solid #cad7ce",
              borderRadius: 5,
              font: "inherit",
              color: "#203a2b",
            }}
          />
        </label>
      )),
      Button: {
        ...make("按钮", ({ label, detail, tone, target, puck }) => (
          <div style={blockStyle}>
            <button
              type="button"
              onClick={() => !puck.isEditing && target && onNavigate?.(target)}
              title={detail}
              style={{
                padding: "11px 24px",
                border: 0,
                borderRadius: 5,
                background: tones[tone],
                color: "#fff",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
            {detail && (
              <small
                style={{ display: "block", marginTop: 8, color: "#6f7d75" }}
              >
                {detail}
              </small>
            )}
          </div>
        )),
        fields: {
          ...fields,
          target: {
            type: "select",
            label: "跳转页面",
            options: [
              { label: "留在当前页", value: "" },
              ...pages.map((page) => ({ label: page.title, value: page.id })),
            ],
          },
        } as Fields<Props>,
      },
      Card: make(
        "卡片",
        ({ label, detail, tone }) => (
          <div style={blockStyle}>
            <div
              style={{
                padding: 22,
                border: "1px solid #dce5df",
                borderTop: `3px solid ${tones[tone]}`,
                borderRadius: 8,
                background: "#f8faf9",
              }}
            >
              <strong style={{ fontSize: 18 }}>{label}</strong>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.8,
                  whiteSpace: "pre-wrap",
                }}
              >
                {detail}
              </p>
            </div>
          </div>
        ),
        "卡片说明",
      ),
      List: make(
        "列表",
        ({ label, detail }) => (
          <div style={blockStyle}>
            <strong>{label}</strong>
            {(detail || "列表项一\n列表项二\n列表项三")
              .split("\n")
              .map((line, index) => (
                <div
                  key={index}
                  style={{
                    padding: "14px 0",
                    borderBottom: "1px solid #e2e9e5",
                    fontSize: 14,
                  }}
                >
                  {line}
                </div>
              ))}
          </div>
        ),
        "列表项一\n列表项二\n列表项三",
      ),
      Divider: {
        label: "分隔线",
        fields: {} as Fields<Props>,
        defaultProps: defaults,
        render: () => (
          <div style={blockStyle}>
            <hr style={{ border: 0, borderTop: "1px solid #dae4dd" }} />
          </div>
        ),
      },
      Columns: {
        label: "双栏布局",
        fields: {
          appearance: {
            ...layoutField,
            objectFields: {
              ...sizeFields,
              gap: numberField("栏间距 px", 0, 200),
              ratio: numberField("左栏宽度 %", 10, 90),
            },
          },
          left: { type: "slot" },
          right: { type: "slot" },
        } as Fields<Props>,
        defaultProps: { ...defaults, appearance: appearanceDefaults },
        render: ({ left: Left, right: Right, appearance: a }) => (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(0,${a?.ratio ?? 50}fr) minmax(0,${100 - (a?.ratio ?? 50)}fr)`,
              gap: a?.gap ?? 12,
              padding: a?.padding ?? 12,
              margin: a?.margin ?? 0,
              width: a?.width || undefined,
              minHeight: a?.height || undefined,
            }}
          >
            <Left minEmptyHeight={120} />
            <Right minEmptyHeight={120} />
          </div>
        ),
      },
      Row: {
        label: "横向布局",
        fields: {
          appearance: layoutField,
          left: { type: "slot" },
        } as Fields<Props>,
        defaultProps: { ...defaults, appearance: appearanceDefaults },
        render: ({ left: Items, appearance: a }) => (
          <Items
            minEmptyHeight={100}
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: a?.wrap ?? "wrap",
              alignItems: a?.align ?? "center",
              justifyContent: a?.justify ?? "start",
              gap: a?.gap ?? 12,
              padding: a?.padding ?? 14,
              margin: a?.margin ?? 0,
              width: a?.width || undefined,
              minHeight: a?.height || undefined,
              boxSizing: "border-box",
            }}
          />
        ),
      },
    },
  };
}
