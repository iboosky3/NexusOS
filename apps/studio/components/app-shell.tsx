import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="NexusOS Studio 首页">
          <span className="brand-mark">N</span>
          <span>
            <strong>NexusOS</strong>
            <small>WORKSPACE</small>
          </span>
        </Link>
        <nav className="topnav" aria-label="主导航">
          <Link className="topnav-link active" href="/">工作台</Link>
          <Link className="topnav-link" href="/runs/run_prd_0187">运行记录</Link>
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
