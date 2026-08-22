interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  tone?: "mint" | "amber" | "violet";
}

export function MetricCard({ label, value, detail, tone = "mint" }: MetricCardProps) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
