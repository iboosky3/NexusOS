import Link from "next/link";
import type { ReactNode } from "react";

const navigation = ["总览", "运行记录", "Agents", "Skills", "Tools / MCP", "评估"];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="NexusOS Studio 首页">
          <span className="brand-mark">N</span>
          <span>
            <strong>NexusOS</strong>
            <small>STUDIO</small>
          </span>
        </Link>
        <nav aria-label="主导航">
          {navigation.map((item, index) => (
            <Link className={index === 0 ? "nav-item active" : "nav-item"} href="/" key={item}>
              <span className="nav-dot" />
              {item}
            </Link>
          ))}
        </nav>
        <div className="environment-card">
          <span className="live-dot" />
          <div>
            <strong>本地开发环境</strong>
            <small>Python Reference Runtime</small>
          </div>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
