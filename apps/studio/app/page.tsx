import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { StatusPill } from "@/components/status-pill";
import { loadRunSummaries } from "@/lib/data-source";

const number = new Intl.NumberFormat("zh-CN");

export default async function DashboardPage() {
  const { data: runs, source, warning } = await loadRunSummaries();

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">CONTROL PLANE / OVERVIEW</p>
          <h1>智能体运行总览</h1>
          <p>观察每次编排的任务图、Skill 决策、质量门与 Token 成本。</p>
        </div>
        <div className="header-actions">
          <span className={source === "api" ? "source-label source-api" : "source-label"}>
            {source === "api" ? "实时 API" : "演示快照"}
          </span>
          <Link className="primary-link-button" href="/projects/demo/workspace">打开 PRD 工作台</Link>
        </div>
      </header>

      {warning && <div className="data-warning" role="status">{warning}，当前显示演示数据。</div>}

      <section className="metric-grid" aria-label="关键指标">
        <MetricCard label="今日运行" value="24" detail="较昨日 +18%" />
        <MetricCard label="质量门通过率" value="87.5%" detail="21 / 24 次通过" tone="violet" />
        <MetricCard label="平均指令 Token" value="1,176" detail="全量加载基线 7,940" tone="amber" />
        <MetricCard label="P95 运行耗时" value="3m 42s" detail="目标阈值 < 5m" />
      </section>

      <section className="dashboard-grid">
        <article className="panel run-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">RECENT RUNS</span>
              <h2>最近运行</h2>
            </div>
            <Link href="/runs/run_prd_0187">查看详情 →</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>运行 / 需求</th>
                  <th>状态</th>
                  <th>质量分</th>
                  <th>Token</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/runs/${run.id}`} className="run-link">
                        <strong>{run.title}</strong>
                        <small>{run.id} · {run.startedAt}</small>
                      </Link>
                    </td>
                    <td><StatusPill status={run.status} /></td>
                    <td className="score-cell">{run.quality?.toFixed(1) ?? "—"}</td>
                    <td>{number.format(run.inputTokens + run.outputTokens)}</td>
                    <td>{run.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="panel health-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">SYSTEM HEALTH</span>
              <h2>组件状态</h2>
            </div>
          </div>
          {[
            ["Orchestrator", "正常", "9 ms"],
            ["Skill Router", "正常", "118 ms p95"],
            ["Model Gateway", "正常", "2 providers"],
            ["MCP Gateway", "开发中", "local policy"],
          ].map(([name, state, detail]) => (
            <div className="health-row" key={name}>
              <span className={state === "正常" ? "health-icon ok" : "health-icon warning"} />
              <div><strong>{name}</strong><small>{detail}</small></div>
              <span>{state}</span>
            </div>
          ))}
          <div className="budget-card">
            <span>本周 Token 预算</span>
            <strong>1.84M <small>/ 3.00M</small></strong>
            <div className="progress"><span style={{ width: "61%" }} /></div>
          </div>
        </aside>
      </section>
    </>
  );
}
