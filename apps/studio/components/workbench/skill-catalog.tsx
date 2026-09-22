"use client";

import { useEffect, useState } from "react";
import { prdApi } from "@/lib/prd-api";
import s from "./agent-catalog.module.css";

export interface SkillSummary {
  id: string;
  version: string;
  description: string;
  domains: string[];
  capabilities: string[];
  keywords: string[];
  required_tools: string[];
}

interface SkillDocument {
  summary: SkillSummary;
  instructions: string;
  manifest: string;
  digest: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
}

export function SkillDirectory({ skills, onOpen, error = "" }: {
  skills: SkillSummary[];
  onOpen(id: string): void;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  return <div className={s.directory}>
    <label className={s.search}>搜索 Skill
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或能力" />
    </label>
    {error && <p role="alert">{error}</p>}
    <ul className={s.entries} aria-label="Skill 清单">
      {skills.filter((skill) => `${skill.id} ${skill.description} ${skill.capabilities.join(" ")}`.toLowerCase().includes(query.toLowerCase()))
        .map((skill) => <li key={skill.id}><button className={s.entry} onClick={() => onOpen(skill.id)}>
          <span className={s.icon}>✧</span><span><strong>{skill.id}</strong><small>{skill.description}</small></span>
        </button></li>)}
    </ul>
    {!skills.length && !error && <p className={s.hint}>暂无已注册的 Skill。</p>}
  </div>;
}

export function SkillDetail({ id }: { id: string }) {
  const [document, setDocument] = useState<SkillDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    setDocument(null); setDraft(""); setEditing(false); setError(""); setNotice("");
    void prdApi<SkillDocument>(`capabilities/skills/${encodeURIComponent(id)}`)
      .then((value) => { if (active) { setDocument(value); setDraft(value.instructions); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [id]);
  async function save() {
    if (!document || busy || !draft.trim() || draft === document.instructions) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await prdApi<SkillDocument>(`capabilities/skills/${encodeURIComponent(id)}`, "PUT", {
        instructions: draft, expected_digest: document.digest,
      });
      setDocument(next); setDraft(next.instructions); setEditing(false);
      setNotice("Skill 原文已保存；后续运行会读取新内容。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }
  if (!document) return <article className={s.detail} aria-label={`${id} Skill 详情`}>
    {error ? <p role="alert">{error}</p> : <p>正在加载 Skill…</p>}
  </article>;
  const { summary } = document;
  return <article className={s.detail} aria-label={`${id} Skill 详情`}>
    <header className={s.hero}><span className={s.heroIcon}>✧</span><div>
      <small>Skill · v{summary.version}</small><h1>{summary.id}</h1><p>{summary.description}</p>
      <small>{summary.domains.join(" · ") || "通用领域"}</small>
    </div></header>
    <section><h2>用途与能力</h2><p>{summary.capabilities.join(" · ") || "未声明能力"}</p>
      <p className={s.hint}>检索关键词：{summary.keywords.join("、") || "未声明"}</p>
      {summary.required_tools.length > 0 && <p>所需工具：{summary.required_tools.join("、")}</p>}
    </section>
    <section><h2>输入与输出</h2><p>输入</p><pre className={s.source}>{JSON.stringify(document.input_schema, null, 2)}</pre>
      <p>输出</p><pre className={s.source}>{JSON.stringify(document.output_schema, null, 2)}</pre>
    </section>
    <section><h2>Skill 原文</h2><p className={s.hint}>查看注册定义和指令原文；此处可编辑 instructions.md，skill.yaml 元数据保持只读。</p>
      <details><summary>查看 skill.yaml 原文</summary><pre className={s.source}>{document.manifest}</pre></details>
      <details open={editing}><summary>查看 instructions.md 原文</summary>
        {editing ? <textarea className={s.sourceEditor} aria-label="编辑 Skill 原文" value={draft}
          onChange={(event) => setDraft(event.target.value)} disabled={busy}
          onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault(); event.stopPropagation(); void save();
          } }} />
          : <pre className={s.source}>{document.instructions}</pre>}
      </details>
      <div className={s.editActions}>
        {editing ? <><button disabled={busy || !draft.trim() || draft === document.instructions} onClick={() => void save()}>保存原文</button>
          <button disabled={busy} onClick={() => { setDraft(document.instructions); setEditing(false); setError(""); }}>取消编辑</button></>
          : <button onClick={() => setEditing(true)}>编辑原文</button>}
      </div>
      {draft !== document.instructions && <p className={s.hint}>有未保存的修改。</p>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </section>
  </article>;
}
