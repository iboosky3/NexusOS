import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

/** A small, text-editable flow format; no executable SVG or HTML is accepted. */
export function FlowDiagram({ value }: { value: string }) {
  const nodes = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
  return (
    <svg
      viewBox={`0 0 620 ${Math.max(1, nodes.length) * 86}`}
      role="img"
      aria-label={`流程图：${nodes.join("，")}`}
      style={{ width: "100%", maxHeight: 650 }}
    >
      {nodes.map((node, index) => (
        <g key={index}>
          <rect
            x="110"
            y={index * 86 + 8}
            width="400"
            height="54"
            rx="8"
            fill="#edf6f0"
            stroke="#74a68a"
          />
          <text
            x="310"
            y={index * 86 + 41}
            textAnchor="middle"
            fill="#22563b"
            fontSize="16"
          >
            {node.slice(0, 26)}
          </text>
          {index < nodes.length - 1 && (
            <path
              d={`M310 ${index * 86 + 62} v26 m-5 -6 l5 6 5 -6`}
              fill="none"
              stroke="#74a68a"
              strokeWidth="2"
            />
          )}
        </g>
      ))}
    </svg>
  );
}

export function DocumentRenderer({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={(url) =>
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)
          ? url
          : defaultUrlTransform(url)
      }
      components={{
        img: ({ src, alt }) => (
          <img
            src={src}
            alt={alt || "文档配图"}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ maxWidth: "100%", height: "auto" }}
          />
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        code: ({ className, children, ...props }) =>
          className === "language-nexus-flow" ? (
            <FlowDiagram value={String(children)} />
          ) : (
            <code {...props} className={className}>
              {children}
            </code>
          ),
        table: ({ children }) => (
          <div className="table-scroll">
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {content}
    </Markdown>
  );
}

export async function imageToDataUrl(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("支持 PNG、JPG、WebP 图片");
  if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过 8 MB");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持图片处理");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    bitmap.close();
  }
}
