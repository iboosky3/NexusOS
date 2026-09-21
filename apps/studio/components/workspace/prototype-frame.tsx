"use client";

import { useEffect, useMemo, useRef } from "react";

interface PrototypeFrameProps {
  html: string;
  interactive: boolean;
  captureRequest: number;
  onSelectNode: (nodeId: string) => void;
  onCapture: (dataUrl?: string) => void;
}

const BRIDGE = String.raw`<script>
(() => {
  const send = (message) => parent.postMessage({ source: "nexus-prototype", ...message }, "*");
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-prototype-node-id]");
    if (!target) return;
    if (document.documentElement.dataset.nexusInteractive !== "true") {
      event.preventDefault();
      event.stopPropagation();
    }
    send({ type: "node:selected", nodeId: target.dataset.prototypeNodeId });
  }, true);
  addEventListener("message", async (event) => {
    if (!event.data || event.data.source !== "nexus-studio") return;
    if (event.data.type === "mode") {
      document.documentElement.dataset.nexusInteractive = String(event.data.interactive);
    }
    if (event.data.type === "capture") {
      try {
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll("script").forEach((node) => node.remove());
        const serialized = new XMLSerializer().serializeToString(clone);
        const width = Math.max(document.documentElement.scrollWidth, 800);
        const height = Math.max(document.documentElement.scrollHeight, 500);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject width="100%" height="100%">' + serialized + '</foreignObject></svg>';
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(image, 0, 0);
          send({ type: "capture:ready", dataUrl: canvas.toDataURL("image/png") });
        };
        image.onerror = () => send({ type: "capture:ready" });
        image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      } catch (_) {
        send({ type: "capture:ready" });
      }
    }
  });
  send({ type: "ready" });
})();
</script>`;

function withBridge(html: string): string {
  return html.includes("</body>") ? html.replace("</body>", `${BRIDGE}</body>`) : `${html}${BRIDGE}`;
}

export function PrototypeFrame({
  html,
  interactive,
  captureRequest,
  onSelectNode,
  onCapture,
}: PrototypeFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridgedHtml = useMemo(() => withBridge(html), [html]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== "nexus-prototype") return;
      if (event.data.type === "ready") {
        frame.current?.contentWindow?.postMessage(
          { source: "nexus-studio", type: "mode", interactive },
          "*",
        );
      }
      if (event.data.type === "node:selected") onSelectNode(String(event.data.nodeId));
      if (event.data.type === "capture:ready") onCapture(event.data.dataUrl);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [interactive, onCapture, onSelectNode]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { source: "nexus-studio", type: "mode", interactive },
      "*",
    );
  }, [interactive]);

  useEffect(() => {
    if (captureRequest > 0) {
      frame.current?.contentWindow?.postMessage(
        { source: "nexus-studio", type: "capture" },
        "*",
      );
    }
  }, [captureRequest]);

  return (
    <iframe
      ref={frame}
      className="prototype-frame"
      sandbox="allow-scripts"
      srcDoc={bridgedHtml}
      title="可运行原型"
    />
  );
}
