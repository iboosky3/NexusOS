"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

const heroPrompts = [
  "今天，我们做什么？",
  "今天，想完成什么？",
  "有什么想法，一起开始？",
  "准备好开始了吗？",
];

const favorites = [
  { icon: "✦", title: "编写 PRD", description: "在专业工作台中创建产品需求文档", href: "/prd-studio", newTab: true },
  { icon: "⌁", title: "竞品研究", description: "整理市场与竞品洞察", href: "/" },
  { icon: "◫", title: "技术方案", description: "产出可落地的技术设计", href: "/" },
];

export default function HomePage() {
  const [request, setRequest] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [intentNotice, setIntentNotice] = useState("");
  const [heroPrompt, setHeroPrompt] = useState(heroPrompts[0]);

  useEffect(() => {
    const randomIndex = Math.floor(Math.random() * heroPrompts.length);
    setHeroPrompt(heroPrompts[randomIndex]);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted("");
    setIntentNotice("");
    if (/prd|产品需求|需求文档/i.test(request)) setSubmitted("编写一份新的产品需求文档");
    else if (request.trim()) setIntentNotice("目前可使用 PRD 编写工具，其他工具仍在建设中。");
  }

  return (
    <div className="home-page">
      <section className="hero-area">
        <div className="hero-mark">✦</div>
        <p className="hero-overline">NEXUSOS STUDIO</p>
        <h1>{heroPrompt}</h1>
        <p className="hero-intro">告诉我你的目标，我会帮你找到合适的智能体与技能，并一起把它完成。</p>
        <form className="request-form" onSubmit={handleSubmit}>
          <span className="search-icon">⌕</span>
          <input value={request} onChange={(event) => setRequest(event.target.value)} placeholder="例如：我要写一个 PRD 文档" aria-label="描述你的需求" />
          <button type="submit" aria-label="开始编排">开始</button>
        </form>
        {intentNotice && <p role="status">{intentNotice}</p>}
        <div className="suggestions">
          {['写一个产品需求文档', '分析这份用户反馈', '规划一次市场调研'].map((suggestion) => (
            <button type="button" key={suggestion} onClick={() => setRequest(suggestion)}>{suggestion}</button>
          ))}
        </div>
      </section>
      {submitted && <section className="orchestration panel"><div className="orchestration-head"><div><span className="panel-kicker">INTENT RECOGNIZED</span><h2>已识别为 PRD 编写任务</h2></div><span className="confidence">工具已就绪</span></div><div className="intent-box"><span className="intent-icon">✦</span><div><strong>产品需求文档（PRD）</strong><p>{submitted}。产品想法和参考材料将在 PRD Studio 中继续填写。</p></div><button type="button" onClick={() => setSubmitted("")}>更改</button></div><div className="flow-label">将在独立工具中使用</div><div className="agent-flow"><div className="flow-step active"><span>01</span><div><strong>需求澄清</strong><small>在 Studio 内补齐必要输入</small></div><b>AI</b></div><i>→</i><div className="flow-step"><span>02</span><div><strong>Agent 与 Skill</strong><small>按需求选择专业能力</small></div><b>TOOLS</b></div><i>→</i><div className="flow-step"><span>03</span><div><strong>图文 PRD</strong><small>生成、编辑并持续评审</small></div><b>DOC</b></div></div><div className="orchestration-actions"><button className="secondary-button" type="button" onClick={() => setSubmitted("")}>返回</button><Link className="primary-button" href="/prd-studio" target="_blank" rel="noopener noreferrer">打开 PRD Studio <span>↗</span></Link></div></section>}
      <section className="favorites-section"><div className="section-title"><div><span className="panel-kicker">YOUR SHORTCUTS</span><h2>从这里开始</h2></div></div><div className="favorite-grid">{favorites.map((favorite) => <Link href={favorite.href} target={favorite.newTab ? "_blank" : undefined} rel={favorite.newTab ? "noopener noreferrer" : undefined} className={`favorite-item${favorite.href === "/" ? " unavailable" : ""}`} aria-disabled={favorite.href === "/"} onClick={event => { if (favorite.href === "/") event.preventDefault(); }} key={favorite.title}><span className="favorite-icon">{favorite.icon}</span><span><strong>{favorite.title}</strong><small>{favorite.href === "/" ? "后续扩展" : favorite.description}</small></span><span className="favorite-arrow">↗</span></Link>)}</div></section>
    </div>
  );
}
