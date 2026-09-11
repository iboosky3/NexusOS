"use client";

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Render } from "@puckeditor/core";
import { toCanvas } from "html-to-image";
import type { PrototypePage } from "@/lib/prototype";
import { designerConfig } from "./config";

export async function captureDesign(page: PrototypePage): Promise<string> {
  if (!page.design) throw new Error("页面没有可截图的设计");
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-20000px;top:0;width:${page.design.width}px;background:white;pointer-events:none;`;
  container.setAttribute("aria-hidden", "true");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    flushSync(() =>
      root.render(
        <Render
          config={designerConfig([])}
          data={{ content: page.design!.content, root: {} }}
        />,
      ),
    );
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    if (container.scrollHeight > 5000)
      throw new Error("页面过长，请拆分成多个原型页面后截图");
    const rendered = await toCanvas(container, {
      pixelRatio: 1,
      backgroundColor: "#ffffff",
      skipFonts: true,
      style: { position: "static", left: "0", top: "0" },
    });
    for (const scale of [1, 0.8, 0.65]) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(rendered.width * scale);
      canvas.height = Math.round(rendered.height * scale);
      canvas
        .getContext("2d")!
        .drawImage(rendered, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.65, 0.45]) {
        const image = canvas.toDataURL("image/jpeg", quality);
        if (image.length <= 35000) return image;
      }
    }
    throw new Error("页面截图过大，请简化或拆分页面后重试");
  } finally {
    root.unmount();
    container.remove();
  }
}
