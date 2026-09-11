"use client";

import { renderToStaticMarkup } from "react-dom/server";
import { PrototypePage } from "@/lib/prototype";

function lines(value: string, width = 42) {
  return value.match(new RegExp(`.{1,${width}}`, "gu")) || [];
}

/** A declarative, script-free canvas. Preview and exported screenshots share this renderer. */
export function PrototypeCanvas({
  page,
  onNavigate,
  onAction,
}: {
  page: PrototypePage;
  onNavigate?: (id: string) => void;
  onAction?: (text: string) => void;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 800 760"
      role="img"
      aria-label={`原型：${page.title}`}
      style={{ width: "100%", maxHeight: 760 }}
    >
      <rect width="800" height="760" fill="#f5f7f8" />
      <rect width="800" height="60" fill="#234b3b" />
      <text x="28" y="39" fill="white" fontSize="21" fontFamily="sans-serif">
        {page.title.slice(0, 30)}
      </text>
      <text x="28" y="93" fill="#61756a" fontSize="13" fontFamily="sans-serif">
        交互线框 · 示例数据与业务规则需确认
      </text>
      {page.elements.map((element, index) => {
        const y = 112 + index * 77;
        const button = element.kind === "button";
        const activate = () =>
          element.target
            ? onNavigate?.(element.target)
            : onAction?.(
                element.detail || `${element.label}：此操作的业务结果待确认`,
              );
        return (
          <g
            key={index}
            role={button && onNavigate ? "button" : undefined}
            tabIndex={button && onNavigate ? 0 : undefined}
            aria-label={button ? element.label : undefined}
            onClick={button ? activate : undefined}
            onKeyDown={
              button
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      activate();
                    }
                  }
                : undefined
            }
            style={{ cursor: button && onNavigate ? "pointer" : "default" }}
          >
            <rect
              x="28"
              y={y}
              width={button ? 240 : 744}
              height="64"
              rx="6"
              fill={button ? "#2d7355" : "white"}
              stroke={button ? "#2d7355" : "#d6e0da"}
            />
            <text
              x="44"
              y={y + 25}
              fontSize="16"
              fill={button ? "white" : "#263c30"}
              fontFamily="sans-serif"
            >
              {element.label.slice(0, button ? 12 : 38)}
            </text>
            <text
              x="44"
              y={y + 48}
              fontSize="12"
              fill={button ? "#dceee3" : "#7c8e82"}
              fontFamily="sans-serif"
            >
              {lines(element.detail, button ? 16 : 55)[0]}
            </text>
            {element.kind === "input" && (
              <path d={`M44 ${y + 55} h700`} stroke="#c1cec6" />
            )}
          </g>
        );
      })}
      <text x="28" y="745" fill="#8a9a90" fontSize="11" fontFamily="sans-serif">
        {page.id} · 原型用于核对页面与操作，不连接真实业务数据
      </text>
    </svg>
  );
}

export async function capturePrototype(page: PrototypePage): Promise<string> {
  if (!page.elements.length) return page.screenshot;
  await document.fonts.ready;
  const svg = renderToStaticMarkup(<PrototypeCanvas page={page} />);
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 760;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法生成截图");
    context.drawImage(image, 0, 0, 800, 760);
    for (const quality of [0.75, 0.55, 0.35]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= 34000) return data;
    }
    const smaller = document.createElement("canvas");
    smaller.width = 640;
    smaller.height = 608;
    smaller.getContext("2d")!.drawImage(canvas, 0, 0, 640, 608);
    const data = smaller.toDataURL("image/jpeg", 0.45);
    if (data.length > 35000)
      throw new Error("原型截图过大，请减少页面内容后重试");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
