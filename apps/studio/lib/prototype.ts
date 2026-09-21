export interface PrototypeElement {
  kind: "text" | "input" | "button" | "list" | "card";
  label: string;
  detail: string;
  target: string;
}
export interface PrototypePage {
  id: string;
  title: string;
  description: string;
  elements: PrototypeElement[];
  screenshot: string;
  design?: PrototypeDesign | null;
}
export interface Prototype {
  input_digest?: string;
  pages: PrototypePage[];
  confirmed: boolean;
  document?: string;
}

/** Versioned, declarative plugin document; never executable HTML or scripts. */
export interface DesignBlock {
  type:
    | "Heading"
    | "Text"
    | "Input"
    | "Button"
    | "Card"
    | "List"
    | "Divider"
    | "Columns"
    | "Row";
  props: {
    id: string;
    label: string;
    detail: string;
    target: string;
    tone: "green" | "blue" | "gray";
    left: DesignBlock[];
    right: DesignBlock[];
    appearance?: {
      width?: number;
      height?: number;
      padding?: number;
      margin?: number;
      fontSize?: number;
      radius?: number;
      color?: string;
      background?: string;
      gap?: number;
      align?: "start" | "center" | "end" | "stretch";
      justify?: "start" | "center" | "end" | "space-between";
      wrap?: "wrap" | "nowrap";
      ratio?: number;
    } | null;
  };
}
export interface PrototypeDesign {
  engine: "puck";
  version: 1;
  width: 960 | 390;
  content: DesignBlock[];
}

export interface PrototypeSelection {
  pageId: string;
  pageTitle: string;
  block: DesignBlock;
}

export type ComponentPropsPatch = Partial<
  Pick<DesignBlock["props"], "label" | "detail" | "tone" | "target">
> & {
  appearance?: NonNullable<DesignBlock["props"]["appearance"]>;
};

export interface PrototypePatchRequest {
  nonce: string;
  pageId: string;
  componentId: string;
  before: string;
  patch: ComponentPropsPatch;
}

export function findDesignBlock(
  blocks: DesignBlock[],
  id: string,
): DesignBlock | undefined {
  for (const block of blocks) {
    if (block.props.id === id) return block;
    const nested = findDesignBlock(
      [...(block.props.left || []), ...(block.props.right || [])],
      id,
    );
    if (nested) return nested;
  }
  return undefined;
}

export function designElements(design: PrototypeDesign): PrototypeElement[] {
  const elements: PrototypeElement[] = [];
  function visit(blocks: DesignBlock[]) {
    for (const block of blocks) {
      if (block.type === "Columns" || block.type === "Row") {
        visit(block.props.left);
        visit(block.props.right);
      } else if (block.type !== "Divider")
        elements.push({
          kind: (
            {
              Heading: "text",
              Text: "text",
              Input: "input",
              Button: "button",
              Card: "card",
              List: "list",
            } as const
          )[block.type],
          label: block.props.label || "未命名组件",
          detail: block.props.detail,
          target: block.type === "Button" ? block.props.target : "",
        });
    }
  }
  visit(design.content);
  return elements;
}

export function prototypeAppendix(prototype: Prototype): string {
  const plain = (value: string) =>
    value.replaceAll("[", "（").replaceAll("]", "）").replaceAll("\n", " ");
  return [
    "<!-- nexus-prototype:start -->\n## 原型页面与交互说明",
    ...prototype.pages.map((page, index) => {
      const actions = page.elements
        .filter((e) => e.kind === "button")
        .map((e) => {
          const target = prototype.pages.find((p) => p.id === e.target)?.title;
          return `- ${plain(e.label)}：${e.detail}${target ? ` → ${plain(target)}` : ""}`;
        });
      return [
        `### P${index + 1} · ${plain(page.title)}`,
        `![P${index + 1} ${plain(page.title)}](${page.screenshot})`,
        page.description,
        ...actions,
      ].join("\n\n");
    }),
    "<!-- nexus-prototype:end -->",
  ].join("\n\n");
}

export function prototypeDesignDocument(prototype: Prototype): string {
  const lines = [
    "# 原型设计方案",
    "",
    `- 页面数量：${prototype.pages.length}`,
    `- 当前状态：${prototype.confirmed ? "已确认" : "设计草稿"}`,
  ];
  for (const [index, page] of prototype.pages.entries()) {
    lines.push(
      "",
      `## P${index + 1} · ${page.title}`,
      "",
      page.description || "待补充页面与交互说明。",
      "",
      `- 画布：${page.design?.width === 390 ? "手机 390px" : "桌面 960px"}`,
    );
    for (const element of page.elements) {
      const target = prototype.pages.find(
        (item) => item.id === element.target,
      )?.title;
      lines.push(
        `- ${element.kind} · ${element.label}${element.detail ? `：${element.detail}` : ""}${target ? ` → ${target}` : ""}`,
      );
    }
  }
  return lines.join("\n").slice(0, 30000);
}

export function archivePrototype(prototype: Prototype): Prototype {
  const next = { ...prototype };
  return { ...next, document: prototypeDesignDocument(next) };
}

export function embedPrototype(content: string, prototype: Prototype) {
  const appendix = prototypeAppendix(prototype);
  const pattern =
    /<!-- nexus-prototype:start -->[\s\S]*?<!-- nexus-prototype:end -->/g;
  const next =
    `${content.replace(pattern, "").trimEnd()}\n\n${appendix}`.trimStart();
  if (next.length > 200000)
    throw new Error("插入后正文超过 200,000 字符，请精简正文或减少页面");
  return next;
}

export function validateDesign(design: PrototypeDesign) {
  if (design.engine !== "puck" || design.version !== 1 ||
      ![390, 960].includes(design.width) || !Array.isArray(design.content))
    throw new Error("原型代码必须包含有效的引擎、版本、画布尺寸和组件列表");
  let count = 0;
  const ids = new Set<string>();
  function visit(blocks: DesignBlock[], depth: number) {
    if (depth > 4) throw new Error("布局最多嵌套 4 层");
    for (const block of blocks) {
      if (!block || ![
        "Heading", "Text", "Input", "Button", "Card", "List", "Divider", "Columns", "Row",
      ].includes(block.type) || !block.props || typeof block.props !== "object")
        throw new Error("原型组件类型或属性无效");
      if (typeof block.props.id !== "string" || !block.props.id ||
          block.props.id.length > 100 ||
          !["label", "detail", "target"].every((key) =>
            typeof block.props[key as "label" | "detail" | "target"] === "string") ||
          !["green", "blue", "gray"].includes(block.props.tone))
        throw new Error("原型组件编号、文字或色调无效");
      if (!Array.isArray(block.props.left) || !Array.isArray(block.props.right) ||
          (block.type !== "Columns" && block.type !== "Row" &&
            (block.props.left.length > 0 || block.props.right.length > 0)) ||
          (block.type === "Row" && block.props.right.length > 0) ||
          (block.type !== "Button" && block.props.target))
        throw new Error("组件插槽或跳转属性无效");
      if (++count > 64) throw new Error("每页最多 64 个组件，请拆分页面");
      if (ids.has(block.props.id))
        throw new Error("组件编号重复，请删除重复组件");
      ids.add(block.props.id);
      if (block.props.label.length > 80 || block.props.detail.length > 200 ||
          block.props.target.length > 40)
        throw new Error("组件名称最多 80 字，说明最多 200 字");
      const appearance = block.props.appearance;
      if (appearance) {
        if (typeof appearance !== "object" ||
            (appearance.align && !["start", "center", "end", "stretch"].includes(appearance.align)) ||
            (appearance.justify && !["start", "center", "end", "space-between"].includes(appearance.justify)) ||
            (appearance.wrap && !["wrap", "nowrap"].includes(appearance.wrap)))
          throw new Error("布局属性无效");
        for (const [key, min, max] of [
          ["width", 0, 1920],
          ["height", 0, 2000],
          ["padding", 0, 200],
          ["margin", 0, 200],
          ["fontSize", 8, 120],
          ["radius", 0, 200],
          ["gap", 0, 200],
          ["ratio", 10, 90],
        ] as const) {
          const value = appearance[key];
          if (
            value !== undefined &&
            (!Number.isInteger(value) || value < min || value > max)
          )
            throw new Error(`样式 ${key} 需为 ${min}–${max} 的整数`);
        }
        for (const color of [appearance.color, appearance.background])
          if (color && !/^#[0-9a-fA-F]{6}$/.test(color))
            throw new Error(
              "颜色请填写 #RRGGBB，例如 #315fba，或留空使用默认颜色",
            );
      }
      if (block.type === "Columns" || block.type === "Row") {
        visit(block.props.left, depth + 1);
        visit(block.props.right, depth + 1);
      }
    }
  }
  visit(design.content, 0);
}
