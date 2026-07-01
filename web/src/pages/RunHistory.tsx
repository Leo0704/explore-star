import { useCallback, useState } from 'react';
import { api, type RunHistoryEntry, type RunHistoryStats } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { MetricCard } from '../components/MetricCard';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { usePolling } from '../hooks/usePolling';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';

const STEP_LABELS: Record<string, string> = {
  reconnaissance: '侦察', analysis: '分析', sync: '同步',
  task_generation: '任务生成', execution: '执行',
  notification: '通知', health_check: '健康检查',
};

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function RunHistory() {
  const [entries, setEntries] = useState<RunHistoryEntry[]>([]);
  const [stats, setStats] = useState<RunHistoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [e, s] = await Promise.allSettled([
      api.getRunHistory(30),
      api.getRunHistoryStats(30),
    ]);
    if (e.status === 'fulfilled') setEntries(e.value.entries.slice().reverse());
    if (s.status === 'fulfilled') setStats(s.value);
    const firstRej = [e, s].find(x => x.status === 'rejected');
    setError(firstRej && firstRej.status === 'rejected' ? formatError(firstRej.reason) : null);
    setLoading(false);
  }, []);

  usePolling(reload, 5000);

  if (loading) return <LoadingSpinner />;

  // Trend data: group by date, count completed vs failed
  const byDate = new Map<string, { date: string; completed: number; failed: number }>();
  for (const e of entries) {
    const d = e.started_at.slice(0, 10);
    const row = byDate.get(d) ?? { date: d, completed: 0, failed: 0 };
    if (e.exit_reason === 'completed') row.completed++;
    else row.failed++;
    byDate.set(d, row);
  }
  const trendData = [...byDate.values()];

  // Step durations bar chart
  const stepData = stats
    ? Object.entries(stats.avgStepDurations).map(([step, ms]) => ({
        step: STEP_LABELS[step] ?? step,
        ms: Math.round(ms / 1000 * 10) / 10,
      }))
    : [];

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Run 历史</div>
        <div className="page-subtitle">最近 30 天共 {stats?.stats.totalRuns ?? 0} 次运行</div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {stats && (
        <div className="metric-grid">
          <MetricCard label="总运行次数" value={stats.stats.totalRuns} color="accent" />
          <MetricCard
            label="失败次数"
            value={stats.stats.failedRuns}
            color={stats.stats.failedRuns > 0 ? 'danger' : 'success'}
            subtitle={stats.stats.totalRuns > 0
              ? `${((stats.stats.failedRuns / stats.stats.totalRuns) * 100).toFixed(1)}% 失败率`
              : undefined}
          />
          <MetricCard label="平均耗时" value={`${(stats.stats.avgDurationMs / 1000).toFixed(1)}s`} />
          <MetricCard
            label="LLM 成本"
            value={`$${stats.cost.totalCostUsd.toFixed(4)}`}
            subtitle={`${stats.cost.totalPromptTokens + stats.cost.totalCompletionTokens} tokens`}
          />
        </div>
      )}

      {/* Trend chart */}
      {trendData.length > 0 && (
        <div className="chart-container">
          <div className="chart-title">每日成功 / 失败趋势</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e3444" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#1e222d', border: '1px solid #2e3444', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="completed" name="成功" stroke="#22c55e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="failed"    name="失败" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Step duration bar chart */}
      {stepData.length > 0 && (
        <div className="chart-container">
          <div className="chart-title">各步骤平均耗时 (秒)</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={stepData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e3444" />
              <XAxis dataKey="step" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#1e222d', border: '1px solid #2e3444', borderRadius: 6, fontSize: 12 }}
              />
              <Bar dataKey="ms" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top errors */}
      {stats?.stats.topErrors && stats.stats.topErrors.length > 0 && (
        <div className="card">
          <div className="card-title">Top 错误</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>次数</th><th>错误信息</th></tr></thead>
              <tbody>
                {stats.stats.topErrors.map((e, i) => (
                  <tr key={i}>
                    <td><span className="badge badge-failed">{e.count}x</span></td>
                    <td style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full timeline */}
      <div className="card">
        <div className="card-title">运行记录</div>
        {entries.length === 0 ? (
          <div className="empty">暂无运行记录</div>
        ) : (
          entries.slice(0, 50).map(r => (
            <div key={r.run_id} className="run-item">
              <StatusBadge status={r.exit_reason} />
              <span className="run-time">{r.started_at.replace('T', ' ').slice(0, 19)}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {r.mode}{r.dry_run ? ' / dry-run' : ''}
              </span>
              <span style={{ flex: 1 }} />
              <span className="run-duration">{(r.duration_ms / 1000).toFixed(2)}s</span>
              {r.cost_estimate && r.cost_estimate.estimated_cost_usd > 0 && (
                <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 8 }}>
                  ${r.cost_estimate.estimated_cost_usd.toFixed(4)}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
