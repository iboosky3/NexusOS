"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

function IconOption({ type, label }: { type: "firefly"; label: string }) {
  return (
    <span className={`icon-option icon-${type}`} title={label} aria-label={label}>
      {type === "firefly" && <svg viewBox="0 0 40 40" aria-hidden="true"><circle className="firefly-glow" cx="20" cy="29" r="9" /><path className="firefly-wing" d="M18 20c-6-5-10-3-11 0 3 3 7 4 11 2M22 20c6-5 10-3 11 0-3 3-7 4-11 2" /><path className="firefly-antenna" d="M18 17 14 13M22 17l4-4" /><ellipse className="firefly-head" cx="20" cy="18" rx="3" ry="2.5" /><path className="firefly-abdomen" d="M17 21c-1 4 0 9 3 12 3-3 4-8 3-12" /><circle className="firefly-light" cx="20" cy="30" r="3" /></svg>}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/prd-studio" || pathname === "/workspace") return <>{children}</>;
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="NexusOS Studio 首页">
          <span className="brand-options" aria-label="图标方案预览">
            <IconOption type="firefly" label="萤火虫方案" />
          </span>
          <span>
            <strong>Nexus Studio</strong>
            <small>让想法落地</small>
          </span>
        </Link>
        <nav className="topnav" aria-label="主导航">
          <Link className="topnav-link active" href="/">工作台</Link>
          <Link className="topnav-link" href="/prd">PRD 文档库</Link>
        </nav>
        <div className="workspace-status">
          <span className="live-dot" />
          <span>本地环境</span>
        </div>
      </header>
      <main className="main-content">{children}</main>
    </div>
  );
}
