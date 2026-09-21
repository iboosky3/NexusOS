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
const tones = { green: "#197358", blue: "#355ec9", gray: "#52647a" };
const blockStyle = { padding: "14px 18px", overflowWrap: "anywhere" as const };
const appearanceDefaults = {
  width: 0,
  height: 0,
  padding: 14,
  margin: 0,
  fontSize: 14,
  radius: 12,
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
        "--block-radius": a ? `${a.radius ?? 12}px` : undefined,
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
            fontFamily: 'Inter, "Microsoft YaHei", system-ui, sans-serif',
            color: "#20342b",
            background: "#fbfcfa",
            minHeight: 600,
            padding: "30px 24px",
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
        <div style={{
          ...blockStyle, padding: "38px 34px", margin: "0 0 12px",
          border: "1px solid #dcece2", borderRadius: 18,
          background: "linear-gradient(125deg,#f1f8f3,#fff 68%)",
        }}>
          <span style={{
            color: tones[tone], fontSize: 11, fontWeight: 800,
            letterSpacing: ".16em", textTransform: "uppercase",
          }}>PRODUCT EXPERIENCE</span>
          <h1 style={{
            fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-.035em",
            color: "#193a2b", margin: "10px 0 12px", lineHeight: 1.2,
          }}>
            {label}
          </h1>
          {detail && <p style={{
            fontSize: 15, lineHeight: 1.75, color: "#62796c", maxWidth: 620, margin: 0,
          }}>{detail}</p>}
        </div>
      )),
      Text: make("文字", ({ label, detail }) => (
        <div style={{ ...blockStyle, fontSize: 15, lineHeight: 1.8, color: "#30473a" }}>
          <strong style={{ fontSize: 17, letterSpacing: "-.015em" }}>{label}</strong>
          <p style={{ margin: "7px 0 0", color: "#687e70", whiteSpace: "pre-wrap" }}>{detail}</p>
        </div>
      )),
      Input: make("输入框", ({ label, detail }) => (
        <label style={{ ...blockStyle, display: "block", fontSize: 13,
          fontWeight: 650, color: "#314e3b" }}>
          {label}
          <input
            aria-label={label}
            placeholder={detail || "请输入"}
            style={{
              display: "block",
              boxSizing: "border-box",
              width: "100%",
              padding: "13px 15px",
              marginTop: 8,
              background: "#fff",
              border: "1px solid #cbded1",
              borderRadius: 11,
              font: "inherit",
              color: "#203a2b",
              boxShadow: "0 3px 10px rgb(29 72 48 / 4%)",
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
                padding: "12px 24px",
                border: 0,
                borderRadius: 11,
                background: tones[tone],
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: `0 8px 18px ${tones[tone]}34`,
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
                border: "1px solid #e0e9e2",
                borderTop: `3px solid ${tones[tone]}`,
                borderRadius: 15,
                background: "#fff",
                boxShadow: "0 12px 30px rgb(28 66 44 / 6%)",
              }}
            >
              <strong style={{ fontSize: 18, color: "#234334" }}>{label}</strong>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.8,
                  color: "#657c6e",
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
            <strong style={{ fontSize: 17, color: "#234334" }}>{label}</strong>
            {(detail || "列表项一\n列表项二\n列表项三")
              .split("\n")
              .map((line, index) => (
                <div
                  key={index}
                  style={{
                    padding: "14px 12px",
                    borderBottom: "1px solid #e2e9e5",
                    fontSize: 14,
                    background: index % 2 ? "#f8fbf8" : "#fff",
                    borderRadius: 8,
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
            <hr style={{ border: 0, borderTop: "1px solid #d6e5da", margin: "10px 0" }} />
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
