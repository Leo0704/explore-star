import { useCallback, useState } from 'react';
import { api, type DlqEntry } from '../api';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { usePolling } from '../hooks/usePolling';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const PERSONA_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

interface Lead {
  cid?: string;
  status?: string;
  persona?: string;
  intent_score?: number;
  nickname?: string;
}

const STATUS_LABELS: Record<string, string> = {
  '新发现': '新发现', '已关注': '已关注', '已互动': '已互动',
  '已加好友': '已加好友', '已私信': '已私信', '已加微': '已加微',
  '已预约': '已预约', '已成交': '已成交', '已流失': '已流失',
};

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [dlq, setDlq] = useState<DlqEntry[]>([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [l, d] = await Promise.allSettled([
      api.getLeads(),
      api.getDlq(),
    ]);
    if (l.status === 'fulfilled') {
      setLeads(l.value.leads as Lead[]);
      setSource(l.value.source);
    }
    if (d.status === 'fulfilled') setDlq(d.value);
    const firstRej = [l, d].find(x => x.status === 'rejected');
    setError(firstRej && firstRej.status === 'rejected' ? formatError(firstRej.reason) : null);
    setLoading(false);
  }, []);

  usePolling(reload, 5000);

  if (loading) return <LoadingSpinner />;

  // Status distribution
  const statusCounts = new Map<string, number>();
  const personaCounts = new Map<string, number>();
  const intentBuckets = [0, 0, 0, 0, 0]; // 0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0

  for (const l of leads) {
    const st = l.status ?? '未知';
    statusCounts.set(st, (statusCounts.get(st) ?? 0) + 1);
    if (l.persona) personaCounts.set(l.persona, (personaCounts.get(l.persona) ?? 0) + 1);
    if (typeof l.intent_score === 'number') {
      const idx = Math.min(4, Math.floor(l.intent_score * 5));
      intentBuckets[idx]++;
    }
  }

  const personaData = [...personaCounts.entries()].map(([name, value]) => ({ name, value }));
  const intentData = ['0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0'].map((range, i) => ({
    range, count: intentBuckets[i],
  }));

  const dlqFailedCount = dlq.reduce((s, e) => s + (e.report?.failed ?? 0), 0);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Lead 漏斗</div>
        <div className="page-subtitle">
          共 {leads.length} 条记录 {source && `(来源: ${source})`}
          {dlqFailedCount > 0 && ` · ${dlqFailedCount} 条 DLQ`}
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <div className="metric-grid">
        <MetricCard label="总 Lead 数" value={leads.length} color="accent" />
        {statusCounts.has('已加微') && <MetricCard label="已加微" value={statusCounts.get('已加微') ?? 0} color="success" />}
        {statusCounts.has('已预约') && <MetricCard label="已预约" value={statusCounts.get('已预约') ?? 0} color="info" />}
        {statusCounts.has('已成交') && <MetricCard label="已成交" value={statusCounts.get('已成交') ?? 0} color="success" />}
        {dlqFailedCount > 0 && <MetricCard label="DLQ 失败" value={dlqFailedCount} color="danger" />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Persona distribution */}
        <div className="chart-container">
          <div className="chart-title">Persona 分布</div>
          {personaData.length === 0 ? (
            <div className="empty">暂无数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={personaData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={d => d.name}>
                  {personaData.map((_, i) => <Cell key={i} fill={PERSONA_COLORS[i % PERSONA_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#1e222d', border: '1px solid #2e3444', borderRadius: 6, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Intent score distribution */}
        <div className="chart-container">
          <div className="chart-title">意图分数分布</div>
          {leads.length === 0 ? (
            <div className="empty">暂无数据</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
              {intentData.map(b => (
                <div key={b.range} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 55, fontFamily: 'var(--font-mono)' }}>{b.range}</span>
                  <div style={{ flex: 1, height: 12, background: 'var(--bg-secondary)', borderRadius: 6, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${leads.length > 0 ? (b.count / leads.length) * 100 : 0}%`,
                        height: '100%',
                        background: 'var(--accent)',
                        borderRadius: 6,
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 30, textAlign: 'right' }}>{b.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Status distribution table */}
      {statusCounts.size > 0 && (
        <div className="card">
          <div className="card-title">生命周期状态分布</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>状态</th><th>数量</th><th>占比</th></tr></thead>
              <tbody>
                {[...statusCounts.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => (
                    <tr key={status}>
                      <td><StatusBadge status={STATUS_LABELS[status] ?? status} /></td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{count}</td>
                      <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {((count / leads.length) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DLQ section */}
      {dlq.length > 0 && (
        <div className="card">
          <div className="card-title">DLQ — CRM 同步失败队列</div>
          {dlq.map((entry, i) => (
            <div key={i} style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <StatusBadge status="failed" />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                  {entry.archived_at?.replace('T', ' ').slice(0, 19)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {entry.report?.failed ?? 0} 条失败 / {entry.report?.total ?? 0} 条总计
                </span>
              </div>
              {entry.report?.errors?.map((err, j) => (
                <div key={j} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 0', fontFamily: 'var(--font-mono)' }}>
                  {err.cid}: {err.error}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
