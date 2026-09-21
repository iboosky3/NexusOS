"use client";

import { Component, type ReactNode } from "react";

/** A faulty trusted editor must not take down resource navigation or task history. */
export class PluginErrorBoundary extends Component<{ children: ReactNode; pluginId: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section role="alert"><p>插件 {this.props.pluginId} 的编辑器发生错误。已保存的资源与本地草稿保留。</p>
      <button onClick={() => this.setState({ failed: false })}>重试加载编辑器</button></section>;
    return this.props.children;
  }
}
