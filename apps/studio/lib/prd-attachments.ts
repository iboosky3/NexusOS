import type { Brief } from "./prd-api";
import { createComponentId } from "./browser-crypto";
import { imageToDataUrl } from "@/components/workbench/document-renderer";

/** Prepare a complete batch before changing any document state. */
export async function preparePrdAttachments(
  files: File[],
  brief: Brief,
  content: string,
) {
  if (files.length > 12) throw new Error("一次最多添加 12 个附件");
  const sources = [...brief.sources];
  const pages = [...(brief.prototype?.pages || [])];
  let images = 0;
  for (const file of files) {
    if (!file.name.trim() || file.name.length > 200)
      throw new Error("附件名称需为 1–200 字符");
    if (/\.(md|txt|markdown)$/i.test(file.name)) {
      if (file.size > 80000) throw new Error(`${file.name} 过大，请精简后添加`);
      const text = (await file.text()).trim();
      if (!text || text.includes("\0"))
        throw new Error(`${file.name} 不是有效的文本材料`);
      if (text.length > 20000) throw new Error(`${file.name} 超过 20,000 字符`);
      sources.push({ name: file.name, content: text });
    } else if (["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      const url = await imageToDataUrl(file);
      pages.push({
        id: createComponentId(),
        title: file.name.slice(0, 80),
        description: "",
        elements: [],
        screenshot: url,
      });
      images += 1;
    } else
      throw new Error(
        `${file.name}：支持 Markdown、TXT、PNG、JPG、WebP；PDF / Word / PPT 请先转换成文本`,
      );
  }
  if (sources.length > 12) throw new Error("最多添加 12 份文本材料");
  if (sources.reduce((sum, item) => sum + item.content.length, 0) > 50000)
    throw new Error("参考材料合计不能超过 50,000 字符");
  if (pages.length > 4) throw new Error("最多添加 4 个原型页面");
  if (pages.reduce((sum, page) => sum + page.screenshot.length, 0) > 140000)
    throw new Error("原型截图合计过大，请压缩图片或减少页面");
  return {
    brief: {
      ...brief,
      sources,
      ...(images ? { prototype: { pages, confirmed: false } } : {}),
    },
    content,
    images,
  };
}
