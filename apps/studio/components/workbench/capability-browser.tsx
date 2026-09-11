"use client";

import { useState } from "react";
import { PanelHeading } from "./workbench";

export interface Capability {
  id: string;
  version: string;
  role?: string;
  description?: string;
  capabilities: string[];
  required_tools?: string[];
  allowed_tools?: string[];
}
/** Catalog inspection is independent of a tool's routing or execution policy. */
export function CapabilityBrowser({
  agents,
  skills,
  used = [],
  error,
  kind,
}: {
  agents: Capability[];
  skills: Capability[];
  used?: string[];
  error?: string;
  kind?: "agents" | "skills";
}) {
  const [search, setSearch] = useState("");
  return (
    <>
      <PanelHeading>
        {kind === "agents"
          ? "智能体 Agent"
          : kind === "skills"
            ? "技能 Skill"
            : "Agent 与 Skill"}
      </PanelHeading>
      <div style={{ padding: 14 }}>
        <input
          aria-label="搜索能力"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索已注册能力"
          style={{
            width: "100%",
            padding: 8,
            border: "1px solid #d3ddd5",
            borderRadius: 4,
          }}
        />
        {error && <p role="alert">{error}</p>}
        {[
          { id: "agents", label: "智能体 Agent", items: agents },
          { id: "skills", label: "专业技能 Skill", items: skills },
        ]
          .filter((group) => !kind || group.id === kind)
          .map((group) => (
            <details
              key={group.label}
              style={{ marginTop: 20 }}
              open={kind || search.trim() ? true : undefined}
            >
              <summary
                style={{ fontSize: 12, color: "#34674a", cursor: "pointer" }}
              >
                {group.label} · {group.items.length}
              </summary>
              {group.items
                .filter((item) =>
                  `${item.id} ${item.role} ${item.description}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((item) => (
                  <details
                    key={item.id}
                    style={{
                      padding: "12px 0",
                      borderBottom: "1px solid #e0e7e2",
                      overflowWrap: "anywhere",
                    }}
                  >
                    <summary style={{ cursor: "pointer", fontSize: 12 }}>
                      <strong>{item.role || item.id}</strong>
                      {used.includes(item.id) && (
                        <span style={{ color: "#257047", marginLeft: 5 }}>
                          已调用
                        </span>
                      )}
                    </summary>
                    {item.description && <p>{item.description}</p>}
                    <small>
                      {item.id} · v{item.version}
                    </small>
                    <p>能力：{item.capabilities.join("、")}</p>
                    {(item.required_tools || item.allowed_tools)?.length ? (
                      <small>
                        工具：
                        {(item.required_tools || item.allowed_tools)?.join(
                          "、",
                        )}
                      </small>
                    ) : null}
                  </details>
                ))}
            </details>
          ))}
        <p style={{ color: "#7a877f", fontSize: 11 }}>
          工作流按阶段自动选择能力。列表来自服务端注册清单。
        </p>
      </div>
    </>
  );
}
