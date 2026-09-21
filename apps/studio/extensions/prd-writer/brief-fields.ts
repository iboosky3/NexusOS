import type { Brief } from "@/lib/prd-api";

export const fields: {
  key: Exclude<keyof Brief, "sources" | "prototype">;
  title: string;
  hint: string;
  rows: number;
  limit: number;
}[] = [
  {
    key: "title",
    title: "产品名称",
    hint: "你正在为哪个产品写需求？",
    rows: 1,
    limit: 200,
  },
  {
    key: "description",
    title: "产品构想与使用场景",
    hint: "描述产品要帮助用户完成的任务，也可以粘贴原始需求。",
    rows: 5,
    limit: 12000,
  },
  {
    key: "audience",
    title: "目标用户与角色",
    hint: "优先服务谁？使用者、管理者和购买者分别是谁？",
    rows: 3,
    limit: 4000,
  },
  {
    key: "problem",
    title: "问题与依据",
    hint: "用户现在怎么做，哪里不好？有哪些访谈、反馈或数据？",
    rows: 4,
    limit: 6000,
  },
  {
    key: "scope",
    title: "首版范围与非目标",
    hint: "必须有哪些功能？明确不做什么？已有优先级也写在这里。",
    rows: 5,
    limit: 8000,
  },
  {
    key: "constraints",
    title: "约束与已确认规则",
    hint: "平台、权限、数据、业务规则、期限、成本等。未知可以写待确认。",
    rows: 4,
    limit: 6000,
  },
  {
    key: "metrics",
    title: "成功指标与验收期待",
    hint: "什么结果代表解决了问题？注明口径及已确认的目标。",
    rows: 3,
    limit: 4000,
  },
  {
    key: "template",
    title: "文档模板（可选）",
    hint: "粘贴公司要求的目录和格式。留空则使用完整的软件 PRD 结构。",
    rows: 3,
    limit: 8000,
  },
];
