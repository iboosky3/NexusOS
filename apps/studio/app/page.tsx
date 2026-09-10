"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

const favorites = [
  { icon: "✦", title: "编写 PRD", description: "从想法到结构化产品需求文档", href: "/prd" },
  { icon: "⌁", title: "竞品研究", description: "整理市场与竞品洞察", href: "/" },
  { icon: "◫", title: "技术方案", description: "产出可落地的技术设计", href: "/" },
];

export default function HomePage() {
  const [request, setRequest] = useState("");
  const [submitted, setSubmitted] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.trim()) setSubmitted(request.trim());
  }

  return (
    <div className="home-page">
      <section className="hero-area">
        <div className="hero-mark">✦</div>
        <p className="hero-overline">NEXUSOS STUDIO</p>
        <h1>今天，我们做什么？</h1>
        <p className="hero-intro">告诉我你的目标，我会帮你找到合适的智能体与技能，并一起把它完成。</p>
        <form className="request-form" onSubmit={handleSubmit}>
          <span className="search-icon">⌕</span>
          <input value={request} onChange={(event) => setRequest(event.target.value)} placeholder="例如：帮我为一款面向大学生的记账 App 编写 PRD" aria-label="描述你的需求" />
          <button type="submit" aria-label="开始编排">开始 <span>↵</span></button>
        </form>
        <div className="suggestions">
          {['写一个产品需求文档', '分析这份用户反馈', '规划一次市场调研'].map((suggestion) => (
            <button type="button" key={suggestion} onClick={() => setRequest(suggestion)}>{suggestion}</button>
          ))}
        </div>
      </section>
      {submitted && <section className="orchestration panel"><div className="orchestration-head"><div><span className="panel-kicker">UNDERSTANDING YOUR REQUEST</span><h2>我理解你想要的是</h2></div><span className="confidence">识别置信度 96%</span></div><div className="intent-box"><span className="intent-icon">✦</span><div><strong>产品需求文档（PRD）</strong><p>{submitted}</p></div><button type="button">编辑</button></div><div className="flow-label">建议的工作编排</div><div className="agent-flow"><div className="flow-step active"><span>01</span><div><strong>产品经理 Agent</strong><small>梳理目标与用户场景</small></div><b>PM</b></div><i>→</i><div className="flow-step"><span>02</span><div><strong>PRD Writer Skill</strong><small>生成结构化需求文档</small></div><b>SKILL</b></div><i>→</i><div className="flow-step"><span>03</span><div><strong>质量审阅 Agent</strong><small>检查完整性与可行性</small></div><b>QA</b></div></div><div className="orchestration-actions"><button className="secondary-button" type="button" onClick={() => setSubmitted("")}>重新描述</button><Link className="primary-button" href="/prd">确认并开始 <span>→</span></Link></div></section>}
      <section className="favorites-section"><div className="section-title"><div><span className="panel-kicker">YOUR SHORTCUTS</span><h2>从这里开始</h2></div><button type="button" className="edit-link">＋ 编辑入口</button></div><div className="favorite-grid">{favorites.map((favorite) => <Link href={favorite.href} className="favorite-item" key={favorite.title}><span className="favorite-icon">{favorite.icon}</span><span><strong>{favorite.title}</strong><small>{favorite.description}</small></span><span className="favorite-arrow">↗</span></Link>)}<button type="button" className="favorite-item add-favorite"><span className="add-icon">＋</span><span><strong>添加入口</strong><small>把常用工作放在这里</small></span></button></div></section>
    </div>
  );
}
