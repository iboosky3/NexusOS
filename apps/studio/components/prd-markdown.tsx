import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function PrdMarkdown({ content }: { content: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: ({ alt }) => <span>[图片：{alt || "未加载"}]</span>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
    table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
  }}>{content}</Markdown>;
}
