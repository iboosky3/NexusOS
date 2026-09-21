"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { browserId } from "@/lib/browser-id";

export default function HomePage() {
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!request.trim()) return;
    setError("");
    // Open synchronously in the click/submit gesture, then transfer the draft
    // explicitly: isolated tabs must not rely on sessionStorage inheritance.
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      setError("新标签页被浏览器拦截，请允许本站弹出窗口后重试。");
      return;
    }
    try {
      tab.opener = null;
      const id = browserId();
      tab.sessionStorage.setItem(`nexus-intent:${id}`, request.trim());
      tab.location.replace(`/orchestrate?draft=${id}`);
    } catch {
      tab.close();
      setError("无法传递任务目标，请允许本地会话存储后重试。");
    }
  }
  return <div className="home-page">
    <section className="hero-area">
      <div className="hero-mark">✦</div><p className="hero-overline">NEXUSOS STUDIO</p>
      <h1>今天，想完成什么？</h1>
      <p className="hero-intro">告诉我你的目标，AI 会检索能力、编排任务；你确认后，即可进入专属工作台。</p>
      <form className="request-form" onSubmit={submit}>
        <span className="search-icon">⌕</span>
        <input value={request} maxLength={12000} onChange={e => setRequest(e.target.value)} placeholder="例如：分析用户反馈，设计并评审两个改进方案" aria-label="描述你的需求" />
        <button type="submit" disabled={!request.trim()} title="在新标签页进行任务编排">开始 ↗</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <div className="suggestions">{["写一个产品需求文档", "分析这份用户反馈", "设计两个用户流程并比较取舍"].map(value => <button key={value} onClick={() => setRequest(value)}>{value}</button>)}</div>
    </section>
    <section className="favorites-section"><div className="section-title"><h2>已有工具</h2></div>
      <Link className="favorite-item" href="/studio" target="_blank" rel="noopener noreferrer"><span className="favorite-icon">✦</span><span><strong>插件工作区</strong><small>独立资源 · 原型设计 · PRD 编写 · Agent 提案</small></span><span>↗</span></Link>
    </section>
  </div>;
}
