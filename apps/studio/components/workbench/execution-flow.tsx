"use client";

import { useEffect, useId, useRef, useState } from "react";
import s from "./execution-flow.module.css";

export interface FlowNode {
  id: string;
  title: string;
  status: string;
  description?: string;
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}
export const executionStatus: Record<string, string> = {
  waiting: "待执行",
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已停止",
  skipped: "未执行",
};
type Point = { x: number; y: number };
const WIDTH = 184,
  HEIGHT = 88;
const limit = (scale: number) => Math.max(0.25, Math.min(1.8, scale));

/** Read-only execution topology; dragging changes presentation, never the workflow. */
export function ExecutionFlow({
  nodes,
  edges,
  selected,
  follow = true,
  onSelect,
  onInteract,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selected: string;
  follow?: boolean;
  onSelect: (id: string) => void;
  onInteract?: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const marker = useId().replace(/:/g, "");
  const [size, setSize] = useState({ width: 900, height: 300 });
  const [offsets, setOffsets] = useState<Record<string, Point>>({});
  const [camera, setCamera] = useState({ x: 20, y: 20, scale: 0.8 });
  const drag = useRef<{
    id: string | null;
    start: Point;
    origin: Point;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const columns = Math.min(5, Math.max(1, nodes.length));
  const positions = Object.fromEntries(
    nodes.map((node, index) => {
      const row = Math.floor(index / columns),
        col = row % 2 ? columns - 1 - (index % columns) : index % columns;
      return [
        node.id,
        offsets[node.id] || { x: 40 + col * 248, y: 34 + row * 158 },
      ];
    }),
  );
  const topology = nodes.map((node) => node.id).join("|");
  function fit() {
    const points = Object.values(positions);
    if (!points.length) return;
    const left = Math.min(...points.map((p) => p.x)) - 32,
      top = Math.min(...points.map((p) => p.y)) - 28;
    const width = Math.max(...points.map((p) => p.x)) + WIDTH + 32 - left;
    const height = Math.max(...points.map((p) => p.y)) + HEIGHT + 28 - top;
    const scale = limit(Math.min(size.width / width, size.height / height, 1));
    setCamera({
      scale,
      x: (size.width - width * scale) / 2 - left * scale,
      y: (size.height - height * scale) / 2 - top * scale,
    });
  }
  useEffect(() => {
    const area = viewport.current;
    if (!area) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    fit();
  }, [topology, size.width, size.height]);
  useEffect(() => {
    if (!follow || !selected || !positions[selected]) return;
    const point = positions[selected];
    setCamera((previous) => {
      const x = point.x * previous.scale + previous.x,
        y = point.y * previous.scale + previous.y;
      if (
        x >= 8 &&
        y >= 8 &&
        x + WIDTH * previous.scale <= size.width - 8 &&
        y + HEIGHT * previous.scale <= size.height - 8
      )
        return previous;
      return {
        ...previous,
        x: size.width / 2 - (point.x + WIDTH / 2) * previous.scale,
        y: size.height / 2 - (point.y + HEIGHT / 2) * previous.scale,
      };
    });
  }, [selected, follow]);
  useEffect(() => {
    const area = viewport.current;
    if (!area) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      onInteract?.();
      const rect = area.getBoundingClientRect(),
        x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      setCamera((previous) => {
        const scale = limit(previous.scale * Math.exp(-event.deltaY * 0.002));
        return {
          scale,
          x: x - ((x - previous.x) * scale) / previous.scale,
          y: y - ((y - previous.y) * scale) / previous.scale,
        };
      });
    };
    area.addEventListener("wheel", wheel, { passive: false });
    return () => area.removeEventListener("wheel", wheel);
  }, [onInteract]);
  function zoom(factor: number) {
    onInteract?.();
    setCamera((previous) => {
      const scale = limit(previous.scale * factor);
      return {
        scale,
        x:
          size.width / 2 -
          ((size.width / 2 - previous.x) * scale) / previous.scale,
        y:
          size.height / 2 -
          ((size.height / 2 - previous.y) * scale) / previous.scale,
      };
    });
  }
  const connections = edges.flatMap((edge) => {
    const from = positions[edge.source],
      to = positions[edge.target];
    if (!from || !to) return [];
    const vertical =
      Math.abs(to.x - from.x) < WIDTH && Math.abs(to.y - from.y) > HEIGHT;
    const forward = vertical ? to.y > from.y : to.x > from.x;
    const start = vertical
      ? { x: from.x + WIDTH / 2, y: from.y + (forward ? HEIGHT : 0) }
      : { x: from.x + (forward ? WIDTH : 0), y: from.y + HEIGHT / 2 };
    const end = vertical
      ? { x: to.x + WIDTH / 2, y: to.y + (forward ? 0 : HEIGHT) }
      : { x: to.x + (forward ? 0 : WIDTH), y: to.y + HEIGHT / 2 };
    const bend =
      Math.max(32, Math.abs(vertical ? end.y - start.y : end.x - start.x) / 2) *
      (forward ? 1 : -1);
    const path = vertical
      ? `M${start.x},${start.y} C${start.x},${start.y + bend} ${end.x},${end.y - bend} ${end.x},${end.y}`
      : `M${start.x},${start.y} C${start.x + bend},${start.y} ${end.x - bend},${end.y} ${end.x},${end.y}`;
    const target = nodes.find((node) => node.id === edge.target);
    return [{ ...edge, start, end, path, status: target?.status }];
  });
  return (
    <div className={s.canvas}>
      <div className={s.controls} role="toolbar" aria-label="流程画布工具">
        <span>工作流画布</span>
        <small>拖动画布 / 节点 · 滚轮缩放</small>
        <button aria-label="缩小流程" onClick={() => zoom(0.8)}>
          −
        </button>
        <output aria-label="画布缩放比例">
          {Math.round(camera.scale * 100)}%
        </output>
        <button aria-label="放大流程" onClick={() => zoom(1.25)}>
          ＋
        </button>
        <button onClick={fit}>适应画布</button>
      </div>
      <div
        ref={viewport}
        className={s.viewport}
        role="region"
        aria-label="运行流程画布"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const id =
            (event.target as HTMLElement).closest<HTMLElement>(
              "[data-flow-node]",
            )?.dataset.flowNode || null;
          drag.current = {
            id,
            start: { x: event.clientX, y: event.clientY },
            origin: id ? positions[id] : { x: camera.x, y: camera.y },
            moved: false,
          };
          suppressClick.current = false;
          // Keep node click targets intact; capture only once a drag actually starts.
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          const dx = event.clientX - current.start.x,
            dy = event.clientY - current.start.y;
          if (!current.moved && Math.hypot(dx, dy) < 5) return;
          if (!current.moved) {
            event.currentTarget.setPointerCapture(event.pointerId);
            onInteract?.();
            current.moved = true;
          }
          suppressClick.current = true;
          if (current.id)
            setOffsets((previous) => ({
              ...previous,
              [current.id!]: {
                x: current.origin.x + dx / camera.scale,
                y: current.origin.y + dy / camera.scale,
              },
            }));
          else
            setCamera((previous) => ({
              ...previous,
              x: current.origin.x + dx,
              y: current.origin.y + dy,
            }));
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          suppressClick.current = true;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          if (drag.current && !drag.current.moved) drag.current = null;
        }}
      >
        <div
          className={s.scene}
          style={{
            transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`,
          }}
        >
          <svg className={s.edges} aria-label="节点连接" width="1" height="1">
            <defs>
              <marker
                id={marker}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {connections.map((edge) => (
              <g key={edge.id} data-flow-edge={edge.id}>
                <path
                  d={edge.path}
                  markerEnd={`url(#${marker})`}
                  data-status={edge.status}
                >
                  <title>
                    {nodes.find((n) => n.id === edge.source)?.title} →{" "}
                    {nodes.find((n) => n.id === edge.target)?.title}
                  </title>
                </path>
                <circle cx={edge.start.x} cy={edge.start.y} r="4" />
                <circle cx={edge.end.x} cy={edge.end.y} r="4" />
              </g>
            ))}
          </svg>
          {nodes.map((node, index) => (
            <button
              key={node.id}
              className={s.node}
              data-flow-node={node.id}
              data-status={node.status}
              style={{
                left: positions[node.id].x,
                top: positions[node.id].y,
                width: WIDTH,
                height: HEIGHT,
              }}
              aria-label={`${node.title} · ${executionStatus[node.status] || node.status}`}
              aria-haspopup="dialog"
              aria-pressed={selected === node.id}
              aria-current={node.status === "running" ? "step" : undefined}
              onClick={() => {
                if (!suppressClick.current) onSelect(node.id);
                suppressClick.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ")
                  suppressClick.current = false;
              }}
            >
              <span className={s.nodeHeading}>
                <span className={s.dot}>
                  {node.status === "succeeded"
                    ? "✓"
                    : String(index + 1).padStart(2, "0")}
                </span>
                <strong>{node.title}</strong>
                <span className={s.open}>↗</span>
              </span>
              <span className={s.description}>
                {node.description || "点击查看执行详情"}
              </span>
              <small>
                <i />
                {executionStatus[node.status] || node.status}
              </small>
            </button>
          ))}
        </div>
        {!nodes.length && <p className={s.empty}>尚无流程节点</p>}
      </div>
    </div>
  );
}
