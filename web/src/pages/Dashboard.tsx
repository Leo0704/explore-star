import { useCallback, useState } from 'react';
import { api, type PipelineState, type RunHistoryEntry, type HealthResult, type DlqEntry, type Task } from '../api';
import { StepPipeline } from '../components/StepPipeline';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { usePolling } from '../hooks/usePolling';

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'var(--danger)',
  medium: 'var(--warning)',
  low: 'var(--text-muted)',
};
const PRIORITY_LABELS: Record<string, string> = { high: '高', medium: '中', low: '低' };
const ACTION_LABELS: Record<string, string> = {
  like_and_follow: '点赞关注',
  comment_reply: '评论回复',
  friend_request: '加好友',
  dm: '私信',
  send_material: '发送资料',
};

export default function Dashboard() {
  const [state, setState] = useState<PipelineState | null>(null);
  const [recent, setRecent] = useState<RunHistoryEntry[]>([]);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [dlq, setDlq] = useState<DlqEntry[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, r, h, d, t] = await Promise.allSettled([
      api.getState(),
      api.getRunHistory(7),
      api.getHealth(),
      api.getDlq(),
      api.getTasks(),
    ]);
    if (s.status === 'fulfilled') setState(s.value);
    if (r.status === 'fulfilled') setRecent(r.value.entries.slice(-5).reverse());
    if (h.status === 'fulfilled') setHealth(h.value);
    if (d.status === 'fulfilled') setDlq(d.value);
    if (t.status === 'fulfilled') setTasks(t.value.tasks);
    const firstRej = [s, r, h, d, t].find(x => x.status === 'rejected');
    setError(firstRej && firstRej.status === 'rejected' ? formatError(firstRej.reason) : null);
    setLoading(false);
  }, []);

  usePolling(reload, 5000);

  if (loading) return <LoadingSpinner />;

  const lastRun = recent[0];
  const dlqFailedCount = dlq.reduce((sum, e) => sum + (e.report?.failed ?? 0), 0);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">探星仪表盘</div>
        <div className="page-subtitle">
          {state?.date ? `${state.date} Pipeline 状态` : '暂无运行数据'}
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {/* DLQ Alert */}
      {dlqFailedCount > 0 && (
        <div className="alert alert-danger">
          ⚠ 有 <strong>{dlqFailedCount}</strong> 条 CRM 同步失败记录未处理，请前往 Lead 漏斗页查看 DLQ 队列。
        </div>
      )}

      {/* Pipeline Steps */}
      {state?.steps && (
        <div className="card">
          <div className="card-title">Pipeline 流水线</div>
          <StepPipeline steps={state.steps} />
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
            更新于 {state.lastUpdatedAt?.replace('T', ' ').slice(0, 19)}
          </div>
        </div>
      )}

      {/* Phase counts from last run */}
      {lastRun && (
        <div className="metric-grid">
          <MetricCard label="视频扫描" value={lastRun.phase_counts.videos_scanned} color="accent" />
          <MetricCard label="评论收集" value={lastRun.phase_counts.comments_collected} color="info" />
          <MetricCard label="Lead 创建" value={lastRun.phase_counts.leads_created} color="success" />
          <MetricCard label="任务生成" value={lastRun.phase_counts.tasks_generated} />
          <MetricCard label="任务执行" value={lastRun.phase_counts.tasks_executed} color={lastRun.phase_counts.tasks_executed > 0 ? 'success' : undefined} />
        </div>
      )}

      {/* Today's tasks */}
      {tasks.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">今日任务（{tasks.length}）</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tasks.slice(0, 10).map(t => (
              <div key={t.task_id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    color: PRIORITY_COLORS[t.priority] ?? 'var(--text-muted)',
                    fontSize: 11, fontWeight: 700, padding: '2px 6px',
                    border: `1px solid ${PRIORITY_COLORS[t.priority] ?? 'var(--border)'}`,
                    borderRadius: 4,
                  }}>
                    {PRIORITY_LABELS[t.priority] ?? t.priority}
                  </span>
                  <span style={{ fontWeight: 600 }}>{t.nickname}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    · {ACTION_LABELS[t.next_action] ?? t.next_action}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    {t.scheduled_at.replace('T', ' ').slice(0, 16)}
                  </span>
                </div>
                {t.hook && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                    💬 {t.hook}
                  </div>
                )}
              </div>
            ))}
            {tasks.length > 10 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 4 }}>
                还有 {tasks.length - 10} 条任务未展示，详情见 <code>data/tmp/tasks-*.json</code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Last Run + Health side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Last Run */}
        <div className="card">
          <div className="card-title">最近一次 Run</div>
          {lastRun ? (
            <div>
              <div style={{ marginBottom: 8 }}>
                <StatusBadge status={lastRun.exit_reason} />
                <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                  {lastRun.mode}{lastRun.dry_run ? ' / dry-run' : ''}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
                {lastRun.started_at.replace('T', ' ').slice(0, 19)}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                {(lastRun.duration_ms / 1000).toFixed(1)}s
              </div>
            </div>
          ) : (
            <div className="empty">暂无 Run 记录</div>
          )}
        </div>

        {/* Health */}
        <div className="card">
          <div className="card-title">系统健康</div>
          {health ? (
            <div>
              <div style={{ marginBottom: 12 }}>
                <StatusBadge status={health.status} />
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>{health.summary}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {health.checks.slice(0, 6).map(c => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <StatusBadge status={c.status} />
                    <span style={{ color: 'var(--text-secondary)' }}>{c.name}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', textAlign: 'right', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty">健康检查不可用</div>
          )}
        </div>
      </div>

      {/* Recent 5 runs */}
      {recent.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">最近 5 次 Run</div>
          {recent.map(r => (
            <div key={r.run_id} className="run-item">
              <StatusBadge status={r.exit_reason} />
              <span className="run-time">{r.started_at.replace('T', ' ').slice(0, 19)}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.mode}{r.dry_run ? ' / dry-run' : ''}</span>
              <span className="run-duration">{(r.duration_ms / 1000).toFixed(1)}s</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
