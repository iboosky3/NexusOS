import type { Prototype } from "./prototype";
export type { Prototype, PrototypePage, PrototypeElement } from "./prototype";

export interface Brief {
  prototype?: Prototype | null;
  title: string;
  description: string;
  audience: string;
  problem: string;
  scope: string;
  constraints: string;
  metrics: string;
  template: string;
  sources: { name: string; content: string }[];
}
export interface Review {
  summary: string;
  status: string;
  notice: string;
  issues: {
    severity: "blocker" | "major" | "minor";
    section: string;
    problem: string;
    suggestion: string;
  }[];
}
export interface PrdDocument {
  id: string;
  brief: Brief;
  content: string;
  revision: number;
  version: number;
  updated_at: string;
  active_job_id: string | null;
  last_job_id: string | null;
  review: Review | null;
  questions: { field: string; question: string }[];
}
export interface DocumentSummary {
  id: string;
  title: string;
  version: number;
  updated_at: string;
  active_job_id: string | null;
}
export interface Job {
  action: "generate" | "revise" | "review" | "prototype";
  instruction: string;
  show_thinking: boolean;
  resume_of_job_id?: string | null;
  recovery?: {
    can_resume: boolean;
    reason: string | null;
    completed_stages: string[];
  };
  id: string;
  status: string;
  stage: string;
  error: string | null;
  input_tokens: number;
  output_tokens: number;
  stream?: {
    stage_id: string;
    title: string;
    content: string;
    reasoning_content: string;
    sequence: number;
    status: string;
    updated_at: string;
  } | null;
  plan?: string[];
  steps: {
    id: string;
    title: string;
    status: string;
    agent_id: string;
    skill_ids: string[];
    content?: string;
  }[];
}
export interface Version {
  version: number;
  brief: Brief;
  content: string;
  note: string;
  created_at: string;
}
export interface Configuration {
  configured: boolean;
  model: string;
}
export const emptyBrief: Brief = {
  prototype: null,
  title: "",
  description: "",
  audience: "",
  problem: "",
  scope: "",
  constraints: "",
  metrics: "",
  template: "",
  sources: [],
};
export async function prdApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/prd/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : Array.isArray(payload.detail)
          ? payload.detail
              .map(
                (item: { loc?: string[]; msg: string }) =>
                  `${item.loc?.slice(1).join(".")}: ${item.msg}`,
              )
              .join("；")
          : `请求失败（${response.status}）`;
    throw new Error(detail);
  }
  return payload as T;
}
export const nexusBrief: Brief = {
  ...emptyBrief,
  title: "NexusOS · Nexus PRD",
  description:
    "NexusOS（纽带）是多智能体编排与 Skill 智能基础设施。当前以 Nexus PRD 为首个实际应用，让用户从原始想法、对话和参考材料出发，形成可供研发、设计和测试评审的中文软件产品需求文档。",
  audience:
    "首版用户是项目维护者和需要编写软件产品需求的产品经理；评审者包括研发、设计、测试。个人或自己的虚拟机使用是暂定部署假设，团队使用范围待确认。",
  problem:
    "原始愿景要求验证复杂系统的 Skill 选择、多 Agent 协作和 Token 效率，同时用于学习、开源和面试展示。目前重点是能写真正的 PRD：现有演示曾使用固定记账内容、模拟延时与固定评分，缺少可靠保存、材料引用和可执行验收条件。",
  scope:
    "P0：结构化简报；补充缺失信息；粘贴或导入 Markdown/TXT 材料；模型驱动的需求、流程、可行性、写作与独立评审；Markdown 编辑与预览；持久化保存、版本历史、根据反馈修订；Markdown/HTML 导出；真实任务状态与失败恢复。首版不做独立竞品研究产品、技能商城、多人实时协同和公网多租户。",
  constraints:
    "Python 负责智能平面，TypeScript 负责 Studio。保留 Agent 选择与 Skill 按需加载；LangGraph 负责单 Agent 图。高并发运行时与网关下沉 Go、低延迟排序下沉 Rust 是后续边界；Temporal 仅在长流程需求成立后启用。不能伪造外部研究、保存状态、评审分数或生产性能。Markdown 为文档源，HTML 用于展示和导出。",
  metrics:
    "验收以真实任务为准：NexusOS 自身 PRD 和另一种软件产品均可完成输入、生成、编辑、保存、重开、修订和导出；内容必须体现各自需求和排除范围。记录实际模型 Token 和阶段状态。质量指标的目标数值需在真实样本测试后确认，不能用合成数据宣称生产效果。",
};
