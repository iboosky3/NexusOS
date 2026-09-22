import { toCanvas } from "html-to-image";
import type { Editor } from "grapesjs";

export async function capture(editor: Editor): Promise<string> {
  const body = editor.Canvas.getBody();
  if (!body) throw new Error("画布尚未准备好");
  await document.fonts.ready;
  const height = Math.max(600, body.scrollHeight);
  if (height > 5000) throw new Error("页面过长，请缩短后截图");
  const rendered = await toCanvas(body, { pixelRatio: 1, backgroundColor: "#ffffff", skipFonts: true,
    width: 960, height, style: { width: "960px", minHeight: `${height}px`, margin: "0" } });
  for (const scale of [1, 0.8, 0.65]) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(rendered.width * scale);
    canvas.height = Math.round(rendered.height * scale);
    canvas.getContext("2d")!.drawImage(rendered, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.6, 0.4]) {
      const image = canvas.toDataURL("image/jpeg", quality);
      if (image.length <= 120000) return image;
    }
  }
  throw new Error("截图过大，请简化页面后重试");
}
