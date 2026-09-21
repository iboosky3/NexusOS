"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  { label: "总览", href: "/" },
  { label: "PRD 工作台", href: "/projects/demo/workspace" },
  { label: "运行记录", href: "/" },
  { label: "Agents", href: "/" },
  { label: "Skills", href: "/" },
  { label: "Tools / MCP", href: "/" },
  { label: "评估", href: "/" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (/^\/projects\/[^/]+\/workspace/.test(pathname)) {
    return <main className="workspace-page">{children}</main>;
  }

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
            <Link
              className={(item.href !== "/" && pathname.startsWith(item.href)) || (index === 0 && pathname === "/") ? "nav-item active" : "nav-item"}
              href={item.href}
              key={item.label}
            >
              <span className="nav-dot" />
              {item.label}
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
