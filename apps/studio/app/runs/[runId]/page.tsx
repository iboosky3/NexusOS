import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import { runDetail } from "@/lib/sample-data";

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = { ...runDetail, id: runId };

  return (
    <>
      <header className="page-header detail-header">
        <div>
          <Link href="/" className="back-link">← 返回运行列表</Link>
          <p className="eyebrow">RUN / {run.id.toUpperCase()}</p>
          <h1>{run.title}</h1>
          <p className="request-copy">{run.request}</p>
        </div>
        <div className="run-summary-status">
          <StatusPill status={run.status} />
          <strong>{run.quality?.toFixed(1)}</strong>
          <small>质量总分</small>
        </div>
      </header>

      <section className="detail-metadata" aria-label="运行元数据">
        <div><span>项目</span><strong>{run.project}</strong></div>
        <div><span>开始时间</span><strong>{run.startedAt}</strong></div>
        <div><span>总耗时</span><strong>{run.duration}</strong></div>
        <div><span>迭代轮次</span><strong>{run.iteration}</strong></div>
        <div><span>Token</span><strong>{(run.inputTokens + run.outputTokens).toLocaleString("zh-CN")}</strong></div>
      </section>

      <section className="detail-grid">
        <article className="panel graph-panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">EXECUTION GRAPH</span><h2>任务执行链</h2></div>
            <span className="panel-note">6 tasks · 2 parallel branches</span>
          </div>
          <div className="task-timeline">
            {run.tasks.map((task, index) => (
              <div className="task-row" key={task.id}>
                <div className="timeline-rail">
                  <span>{index + 1}</span>
                  {index < run.tasks.length - 1 && <i />}
                </div>
                <div className="task-card">
                  <div>
                    <span className="task-id">{task.id}</span>
                    <h3>{task.title}</h3>
                    <p>{task.agent} · {task.duration}</p>
                  </div>
                  <div className="task-skills">
                    {task.skills.map((skill) => <code key={skill}>{skill}</code>)}
                  </div>
                  <StatusPill status={task.status} />
                </div>
              </div>
            ))}
          </div>
        </article>

        <div className="right-stack">
          <article className="panel review-panel">
            <div className="panel-heading">
              <div><span className="panel-kicker">QUALITY GATE</span><h2>质量维度</h2></div>
            </div>
            {Object.entries(run.review).map(([label, value]) => (
              <div className="review-row" key={label}>
                <span>{label}</span>
                <div className="review-bar"><span style={{ width: `${value}%` }} /></div>
                <strong>{value}</strong>
              </div>
            ))}
          </article>

          <article className="panel artifact-panel">
            <div className="panel-heading">
              <div><span className="panel-kicker">ARTIFACTS</span><h2>运行产物</h2></div>
            </div>
            {run.artifacts.map((artifact) => (
              <div className="artifact-row" key={artifact.name}>
                <span className="file-icon">↗</span>
                <div><strong>{artifact.name}</strong><small>{artifact.mediaType} · {artifact.size}</small></div>
              </div>
            ))}
          </article>
        </div>
      </section>

      <section className="panel routing-panel">
        <div className="panel-heading">
          <div><span className="panel-kicker">ROUTING EXPLAINABILITY</span><h2>Skill 选择解释</h2></div>
          <span className="panel-note">显示候选得分、预算和排除原因</span>
        </div>
        <div className="routing-grid">
          {run.routing.map((decision) => (
            <article className={decision.selected ? "route-card selected" : "route-card"} key={decision.skillId}>
              <div className="route-score">
                <strong>{decision.score.toFixed(3)}</strong>
                <span>{decision.selected ? "已选择" : "已排除"}</span>
              </div>
              <h3>{decision.skillId}</h3>
              <ul>{decision.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              <small>{decision.instructionTokens} instruction tokens</small>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
