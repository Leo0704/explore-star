import { useCallback, useMemo, useState } from 'react';
import { api, type LeadEvent } from '../api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { usePolling } from '../hooks/usePolling';

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const EVENT_TYPE_LABELS: Record<LeadEvent['event'], string> = {
  lead_status_changed: '状态变更',
  lead_created: 'Lead 创建',
  task_executed: '任务执行',
  touchpoint_sent: '触达发送',
  touchpoint_replied: '触达回复',
};

const EVENT_TYPE_COLORS: Record<LeadEvent['event'], string> = {
  lead_status_changed: 'var(--info)',
  lead_created: 'var(--accent)',
  task_executed: 'var(--success)',
  touchpoint_sent: 'var(--warning)',
  touchpoint_replied: 'var(--success)',
};

type EventTypeFilter = 'all' | LeadEvent['event'];

export default function Events() {
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EventTypeFilter>('all');

  const reload = useCallback(async () => {
    try {
      const data = await api.getEvents();
      // events.jsonl is append-only; sort newest first
      const sorted = [...data].sort((a, b) =>
        b.interaction_time.localeCompare(a.interaction_time)
      );
      setEvents(sorted);
      setError(null);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(reload, 5000);

  const filtered = useMemo(
    () => filter === 'all' ? events : events.filter(e => e.event === filter),
    [events, filter],
  );

  if (loading) return <LoadingSpinner />;

  const typeCounts: Record<string, number> = {};
  for (const e of events) typeCounts[e.event] = (typeCounts[e.event] ?? 0) + 1;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">事件流</div>
        <div className="page-subtitle">共 {events.length} 条事件 · 显示最近 50 条</div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {/* Type filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          className={`section-tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          全部 ({events.length})
        </button>
        {(Object.keys(EVENT_TYPE_LABELS) as LeadEvent['event'][]).map(t => (
          typeCounts[t] != null && (
            <button
              key={t}
              className={`section-tab ${filter === t ? 'active' : ''}`}
              onClick={() => setFilter(t)}
            >
              {EVENT_TYPE_LABELS[t]} ({typeCounts[t]})
            </button>
          )
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📭</div>
          {events.length === 0 ? '暂无事件' : '当前筛选下无事件'}
        </div>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.slice(0, 50).map((e, i) => (
              <div
                key={`${e.cid}-${e.interaction_time}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: i < Math.min(filtered.length, 50) - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{
                  display: 'inline-block',
                  minWidth: 80,
                  padding: '2px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: EVENT_TYPE_COLORS[e.event] ?? 'var(--text-muted)',
                  border: `1px solid ${EVENT_TYPE_COLORS[e.event] ?? 'var(--border)'}`,
                  borderRadius: 4,
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}>
                  {EVENT_TYPE_LABELS[e.event] ?? e.event}
                </span>
                <div style={{ flex: 1, fontSize: 12 }}>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{e.cid}</span>
                    {e.persona && (
                      <span style={{ color: 'var(--text-muted)' }}> · {e.persona}</span>
                    )}
                    {e.from_status && e.to_status && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        {' · '}{e.from_status} → {e.to_status}
                      </span>
                    )}
                  </div>
                  {e.hook_text && (
                    <div style={{ color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
                      💬 {e.hook_text}
                    </div>
                  )}
                </div>
                <span style={{
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                }}>
                  {e.interaction_time.replace('T', ' ').slice(0, 16)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
