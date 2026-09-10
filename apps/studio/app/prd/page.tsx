"use client";

import Link from "next/link";
import { useState } from "react";

export default function PrdPage() {
  const [title, setTitle] = useState("校园记账 App");
  const [brief, setBrief] = useState("为大学生提供简单、快速的日常记账体验，帮助他们了解自己的消费习惯。");

  return <div className="prd-page">
    <Link className="back-link" href="/">← 返回工作台</Link>
    <div className="prd-header"><div><span className="panel-kicker">PRD WORKSPACE / DRAFT</span><h1>编写产品需求文档</h1><p>先完善下面的关键信息，智能体会据此生成第一版文档。</p></div><div className="prd-actions"><span className="save-state">● 自动保存</span><button type="button" className="primary-button">生成 PRD <span>→</span></button></div></div>
    <div className="prd-layout"><main className="editor-panel panel"><div className="editor-toolbar"><span>产品概述</span><span>1 / 4</span></div><label>产品名称<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>一句话描述<textarea value={brief} onChange={(event) => setBrief(event.target.value)} rows={4} /></label><label>目标用户<input placeholder="例如：18-24 岁的在校大学生" /></label><label>要解决的问题<textarea placeholder="用户现在遇到什么问题？为什么值得解决？" rows={5} /></label></main><aside className="prd-side panel"><span className="panel-kicker">AI ASSISTANT</span><h2>一起把想法变清楚</h2><p>完成左侧信息后，我会继续追问关键细节，并自动组织成完整的 PRD。</p><div className="question-card"><strong>建议先补充</strong><span>目标用户每天会在什么场景下打开这个 App？</span><button type="button">回答这个问题 ↗</button></div><div className="checklist"><strong>文档进度</strong><span>产品概述 <b>进行中</b></span><span>用户与场景 <b>待开始</b></span><span>功能需求 <b>待开始</b></span></div></aside></div>
  </div>;
}