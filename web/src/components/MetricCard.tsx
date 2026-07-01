interface MetricCardProps {
  label: string;
  value: string | number;
  color?: 'accent' | 'success' | 'warning' | 'danger' | 'info';
  subtitle?: string;
}

export function MetricCard({ label, value, color, subtitle }: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${color ?? ''}`}>{value}</div>
      {subtitle && <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}
