"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import styles from "./workbench.module.css";

export interface WorkbenchCommand {
  id: string;
  label: string;
  run: () => void;
  disabled?: boolean;
}
export interface WorkbenchView {
  id: string;
  label: string;
  icon: string;
}

/** Tool-neutral layout; business state and API calls belong to the caller. */
export function Workbench({
  title,
  home,
  menus = [],
  commands = [],
  toolbar,
  views = [],
  activeView,
  onView = () => {},
  sidebar,
  children,
  assistant,
  assistantFocusToken = 0,
  sidebarFocusToken = 0,
  bottomFocusToken = 0,
  bottom,
  status,
  statusRight,
  showActivityLabels = true,
}: {
  title: string;
  home: ReactNode;
  menus?: { label: string; commands: WorkbenchCommand[] }[];
  commands?: WorkbenchCommand[];
  toolbar?: ReactNode;
  views?: WorkbenchView[];
  activeView?: string;
  onView?: (id: string) => void;
  sidebar?: ReactNode;
  children: ReactNode;
  assistant?: ReactNode;
  assistantFocusToken?: number;
  sidebarFocusToken?: number;
  bottomFocusToken?: number;
  bottom?: ReactNode;
  status?: ReactNode;
  statusRight?: ReactNode;
  showActivityLabels?: boolean;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [palette, setPalette] = useState(false);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [panel, setPanel] = useState(true);
  useEffect(() => { if (bottomFocusToken) setPanel(true); }, [bottomFocusToken]);
  useEffect(() => {
    if (sidebarFocusToken) setLeft(true);
  }, [sidebarFocusToken]);
  const paletteTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (assistantFocusToken) setRight(true);
  }, [assistantFocusToken]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
        setPalette(false);
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        setPalette((value) => !value);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  function closePalette() {
    setPalette(false);
    paletteTrigger.current?.focus();
  }
  const matches = commands.filter((command) =>
    command.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className={styles.workbench}>
      <header className={styles.menubar}>
        <div className={styles.brand}>
          {home}
          <strong>{title}</strong>
        </div>
        {menus.length > 0 && (
          <nav aria-label="工具菜单">
            {menus.map((item) => (
              <div className={styles.menu} key={item.label}>
                <button
                  aria-expanded={menu === item.label}
                  onClick={() =>
                    setMenu(menu === item.label ? null : item.label)
                  }
                >
                  {item.label}
                </button>
                {menu === item.label && (
                  <>
                    <button
                      className={styles.dismiss}
                      aria-label="关闭菜单"
                      onClick={() => setMenu(null)}
                    />
                    <div className={styles.dropdown}>
                      {item.commands.map((command) => (
                        <button
                          key={command.id}
                          disabled={command.disabled}
                          onClick={() => {
                            setMenu(null);
                            command.run();
                          }}
                        >
                          {command.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </nav>
        )}
        {commands.length > 0 && (
          <button
            ref={paletteTrigger}
            className={styles.search}
            aria-label="打开命令搜索"
            onClick={() => setPalette(true)}
          >
            ⌕ <span>搜索命令… Ctrl/⌘ ⇧ P</span>
          </button>
        )}
      </header>
      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
      <div className={styles.body}>
        {views.length > 0 && (
          <nav
            className={`${styles.activity} ${showActivityLabels ? "" : styles.iconsOnly}`}
            aria-label="工作区视图"
          >
            {views.map((view) => (
              <button
                key={view.id}
                title={view.label}
                aria-label={view.label}
                aria-pressed={left && activeView === view.id}
                onClick={() => {
                  if (activeView === view.id && left) setLeft(false);
                  else {
                    setLeft(true);
                    onView(view.id);
                  }
                }}
              >
                <span>{view.icon}</span>
                {showActivityLabels && <small>{view.label}</small>}
              </button>
            ))}
          </nav>
        )}
        {left && sidebar && <aside className={styles.sidebar}>{sidebar}</aside>}
        <main className={styles.center}>
          {children}
          {panel && bottom && (
            <section className={styles.bottom}>{bottom}</section>
          )}
        </main>
        {assistant && (
          <aside
            className={styles.assistant}
            style={right ? undefined : { display: "none" }}
            aria-hidden={!right}
          >
            {assistant}
          </aside>
        )}
      </div>
      {(status || statusRight) && (
        <footer className={styles.status}>
          <div>{status}</div>
          <div>
            {sidebar && (
              <button aria-pressed={left} onClick={() => setLeft(!left)}>
                侧栏
              </button>
            )}
            {bottom && (
              <button aria-pressed={panel} onClick={() => setPanel(!panel)}>
                面板
              </button>
            )}
            {assistant && (
              <button aria-pressed={right} onClick={() => setRight(!right)}>
                AI 对话
              </button>
            )}
            {statusRight}
          </div>
        </footer>
      )}
      {palette && (
        <div className={styles.overlay} onClick={closePalette}>
          <section
            className={styles.palette}
            role="dialog"
            aria-modal="true"
            aria-label="命令搜索"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") closePalette();
              if (event.key === "Tab") {
                const elements =
                  event.currentTarget.querySelectorAll<HTMLElement>(
                    "input, button:not(:disabled)",
                  );
                const first = elements[0],
                  last = elements[elements.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div>
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索命令"
                aria-label="搜索命令"
              />
              <button onClick={closePalette}>关闭</button>
            </div>
            {matches.map((command) => (
              <button
                key={command.id}
                disabled={command.disabled}
                onClick={() => {
                  closePalette();
                  command.run();
                }}
              >
                {command.label}
                <span>↵</span>
              </button>
            ))}
            {!matches.length && <p>没有匹配的命令</p>}
          </section>
        </div>
      )}
    </div>
  );
}

export function EditorTabs({
  tabs,
  value,
  onChange,
  onClose,
  closableIds = [],
}: {
  tabs: WorkbenchView[];
  value: string;
  onChange: (id: string) => void;
  onClose?: () => void;
  closableIds?: string[];
}) {
  return (
    <nav className={styles.tabs} aria-label="编辑器标签">
      {tabs.map((tab) => (
        <div className={styles.tab} key={tab.id}>
          <button
            aria-current={value === tab.id ? "page" : undefined}
            onClick={() => onChange(tab.id)}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
          {onClose && closableIds.includes(tab.id) && (
            <button
              className={styles.closeTab}
              aria-label={`关闭${tab.label}`}
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </nav>
  );
}

export function PanelHeading({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.heading}>
      <strong>{children}</strong>
      {actions}
    </div>
  );
}
