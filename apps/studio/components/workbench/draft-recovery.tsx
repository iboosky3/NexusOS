"use client";

import type { DraftCandidate } from "@/lib/workspace/draft-store";

export function DraftRecovery({ candidates, disabled, onRestore, onDiscard }: {
  candidates: DraftCandidate[]; disabled: boolean;
  onRestore(candidate: DraftCandidate): void; onDiscard(candidate: DraftCandidate): void;
}) {
  if (!candidates.length) return null;
  return <details aria-label="可恢复的本地草稿">
    <summary>发现 {candidates.length} 份本地草稿（包括其他窗口）</summary>
    <p>选择后载入当前窗口，不会自动覆盖服务器。请先保存或备份当前修改。</p>
    {candidates.map((candidate) => <section key={candidate.id}>
      <p>{candidate.record ? new Date(candidate.record.updatedAt).toLocaleString() : "损坏草稿 · 原始数据保留"}</p>
      <button disabled={disabled || !candidate.record} onClick={() => onRestore(candidate)}>恢复这份草稿</button>
      <button onClick={() => {
        const url = URL.createObjectURL(new Blob([candidate.raw], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = `draft-${candidate.id}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>下载草稿备份</button>
      <button disabled={disabled} onClick={() => onDiscard(candidate)}>删除这份草稿</button>
    </section>)}
  </details>;
}
