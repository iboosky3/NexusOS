"use client";
import { Render } from "@puckeditor/core";
import { PrototypePage } from "@/lib/prototype";
import { designerConfig } from "./config";
export default function DesignPreview({
  page,
  pages,
  onNavigate,
}: {
  page: PrototypePage;
  pages: PrototypePage[];
  onNavigate: (id: string) => void;
}) {
  if (!page.design) return null;
  return (
    <div style={{ overflow: "auto" }}>
      <div style={{ width: page.design.width, margin: "auto" }}>
        <Render
          config={designerConfig(pages, onNavigate)}
          data={{ content: page.design.content, root: {} }}
        />
      </div>
    </div>
  );
}
