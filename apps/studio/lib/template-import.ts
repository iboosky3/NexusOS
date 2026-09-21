/** Extract template text locally; neither attachments nor macros are executed. */
export async function readTemplate(file: File): Promise<string> {
  const docx = /\.docx$/i.test(file.name);
  if (!docx && !/\.(md|markdown|txt)$/i.test(file.name))
    throw new Error("请选择 Markdown、TXT 或 Word（.docx）模板");
  if (file.size > (docx ? 5_000_000 : 100_000))
    throw new Error("模板文件过大；文本文件最大 100 KB，Word 文件最大 5 MB");
  let content: string;
  try {
    content = docx
      ? (
          await (
            await import("mammoth")
          ).extractRawText({ arrayBuffer: await file.arrayBuffer() })
        ).value.trim()
      : new TextDecoder("utf-8", { fatal: true })
          .decode(await file.arrayBuffer())
          .replace(/^\uFEFF/, "")
          .trim();
  } catch {
    throw new Error(
      docx
        ? "无法读取 Word 模板，请检查文件是否损坏、加密或并非真正的 .docx 文件"
        : "无法读取文本模板，请使用 UTF-8 编码的 Markdown 或 TXT 文件",
    );
  }
  if (!content || content.includes("\0"))
    throw new Error("模板没有有效文字，请使用包含目录和格式要求的文件");
  if (content.length > 8000)
    throw new Error(
      `模板有 ${content.length.toLocaleString()} 字符，超过 8,000 字符，请精简后重新上传`,
    );
  return content;
}
