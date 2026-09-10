"use client";

import { Brief } from "@/lib/prd-api";
import { fields } from "@/lib/use-prd-studio";
import s from "./studio.module.css";

const groups = [
  {
    title: "产品构想",
    hint: "描述想要打造的产品、使用场景和价值。",
    keys: ["title", "description"],
  },
  {
    title: "用户与问题",
    hint: "明确用户是谁、遇到了什么困难，以及问题依据。",
    keys: ["audience", "problem"],
  },
  {
    title: "范围与约束",
    hint: "定义功能边界、首版不做的内容和已确认规则。",
    keys: ["scope", "constraints"],
  },
  {
    title: "成功与验收",
    hint: "定义产品的成功，以及可以观察的验收标准。",
    keys: ["metrics"],
  },
];

export function BriefEditor({
  brief,
  onChange,
  disabled,
  onSources,
}: {
  brief: Brief;
  onChange: (brief: Brief) => void;
  disabled: boolean;
  onSources: () => void;
}) {
  const complete = fields.filter(
    (field) => field.key !== "template" && brief[field.key].trim(),
  ).length;
  return (
    <div className={s.brief}>
      <header className={s.briefHeader}>
        <div>
          <span className={s.documentIcon}>▤</span>
          <div>
            <h1>需求简报</h1>
            <p>填写关键信息，或在右侧与 AI 对话，逐步完善需求。</p>
          </div>
        </div>
        <div className={s.completeness}>
          <span>
            信息填写 <b>{complete} / 7</b>
          </span>
          <progress value={complete} max={7} />
          <small>{7 - complete} 项待补充</small>
        </div>
      </header>
      <fieldset disabled={disabled}>
        {groups.map((group, index) => (
          <section className={s.briefSection} key={group.title}>
            <header>
              <span>{index + 1}</span>
              <h2>{group.title}</h2>
              <p>{group.hint}</p>
              <small>
                {group.keys.every((key) =>
                  brief[key as keyof Omit<Brief, "sources">].trim(),
                )
                  ? "已填写"
                  : "待填写"}
              </small>
            </header>
            <div className={s.fields}>
              {fields
                .filter((field) => group.keys.includes(field.key))
                .map((field) => (
                  <label
                    key={field.key}
                    className={field.key === "description" ? s.wide : undefined}
                    htmlFor={`studio-${field.key}`}
                  >
                    <span>
                      {field.title}
                      {["title", "description"].includes(field.key) && " *"}
                    </span>
                    {field.rows === 1 ? (
                      <input
                        id={`studio-${field.key}`}
                        value={brief[field.key]}
                        maxLength={field.limit}
                        onChange={(event) =>
                          onChange({
                            ...brief,
                            [field.key]: event.target.value,
                          })
                        }
                        placeholder={field.hint}
                      />
                    ) : (
                      <textarea
                        id={`studio-${field.key}`}
                        value={brief[field.key]}
                        maxLength={field.limit}
                        onChange={(event) =>
                          onChange({
                            ...brief,
                            [field.key]: event.target.value,
                          })
                        }
                        rows={2}
                        placeholder={field.hint}
                      />
                    )}
                    <small>
                      {brief[field.key].length.toLocaleString()} /{" "}
                      {field.limit.toLocaleString()}
                    </small>
                  </label>
                ))}
            </div>
          </section>
        ))}
        <details className={s.template}>
          <summary>文档模板（可选）</summary>
          <textarea
            aria-label="文档模板"
            value={brief.template}
            maxLength={8000}
            onChange={(event) =>
              onChange({ ...brief, template: event.target.value })
            }
            rows={4}
            placeholder="粘贴公司要求的目录和格式"
          />
        </details>
      </fieldset>
      <button className={s.sourceStrip} onClick={onSources}>
        <span>♧</span>
        <strong>附加资料</strong>
        <span>
          {brief.sources.length
            ? `${brief.sources.length} 份来源材料`
            : "添加访谈、业务规则、参考文档或配图"}
        </span>
        <b>＋</b>
      </button>
    </div>
  );
}
