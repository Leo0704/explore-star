import { useCallback, useState } from 'react';
import { api, type WeeklyInsights, type LearnedExamples } from '../api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { usePolling } from '../hooks/usePolling';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function Insights() {
  const [insights, setInsights] = useState<WeeklyInsights | null>(null);
  const [learned, setLearned] = useState<LearnedExamples | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [i, l] = await Promise.allSettled([
      api.getInsights(),
      api.getLearned(),
    ]);
    if (i.status === 'fulfilled') setInsights(i.value);
    if (l.status === 'fulfilled') setLearned(l.value);
    const firstRej = [i, l].find(x => x.status === 'rejected');
    setError(firstRej && firstRej.status === 'rejected' ? formatError(firstRej.reason) : null);
    setLoading(false);
  }, []);

  usePolling(reload, 5000);

  if (loading) return <LoadingSpinner />;

  if (!insights) return (
    <div>
      <div className="page-header"><div className="page-title">反馈洞察</div></div>
      <div className="empty"><div className="empty-icon">📊</div>暂无洞察数据，请先运行 insights 命令</div>
    </div>
  );

  const hookData = insights.hook_style_performance.map(h => ({
    style: h.style, tested: h.tested, replied: h.replied,
  }));

  return (
    <div>
      <div className="page-header">
        <div className="page-title">反馈洞察</div>
        <div className="page-subtitle">
          周报生成于 {insights.generated_at?.replace('T', ' ').slice(0, 19)}
          {insights.week_start && ` · 周起始 ${insights.week_start}`}
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {/* Learning period */}
      <div className={`alert ${insights.learning_period_complete ? 'alert-success' : 'alert-warning'}`}>
        {insights.learning_period_complete
          ? '✓ 学习期已完成（14 天 + 30 leads），关键词权重可自动调整'
          : '⟳ 学习期进行中：需要至少 14 天运行 + 30 个 leads + 每个 persona 至少 5 个'}
      </div>

      {/* Persona value cards */}
      {insights.persona_value.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Persona 价值评分
          </div>
          <div className="persona-cards">
            {insights.persona_value.map(pv => (
              <div key={pv.persona} className="persona-card">
                <div className="persona-name">{pv.persona}</div>
                <div className="persona-score" style={{ color: pv.value_score >= 7 ? 'var(--success)' : pv.value_score >= 4 ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {pv.value_score.toFixed(1)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  {pv.leads} leads · {pv.conversions} 转化 · ¥{pv.revenue}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hook style chart */}
      {hookData.length > 0 && (
        <div className="chart-container">
          <div className="chart-title">钩子风格表现</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hookData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e3444" />
              <XAxis dataKey="style" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1e222d', border: '1px solid #2e3444', borderRadius: 6, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="tested"  name="已测试" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="replied" name="有回应" fill="#22c55e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Keyword performance table */}
      {insights.keyword_performance.length > 0 && (
        <div className="card">
          <div className="card-title">关键词表现</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>关键词</th><th>Leads</th><th>转化</th><th>转化率</th>
                  <th>当前权重</th><th>建议权重</th><th>自动调整</th>
                </tr>
              </thead>
              <tbody>
                {insights.keyword_performance.map(kw => (
                  <tr key={kw.keyword}>
                    <td style={{ fontWeight: 600 }}>{kw.keyword}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{kw.leads}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{kw.conversions}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: kw.rate > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                      {(kw.rate * 100).toFixed(1)}%
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{kw.weight.toFixed(2)}</span>
                        <div className="kw-weight-bar">
                          <div className="kw-weight-fill" style={{ width: `${Math.min(100, kw.weight / 3 * 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: kw.suggested_weight != null ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {kw.suggested_weight?.toFixed(2) ?? '—'}
                    </td>
                    <td>
                      {kw.auto_apply
                        ? <span className="badge badge-ok">自动</span>
                        : <span className="badge badge-pending">手动</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Best interaction times heatmap */}
      {insights.best_interaction_times.length > 0 && (
        <div className="card">
          <div className="card-title">最佳交互时间</div>
          {insights.best_interaction_times.map(bt => (
            <div key={bt.persona} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                {bt.persona}
              </div>
              <div className="heatmap">
                {/* Header row */}
                <div className="heatmap-label" />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="heatmap-label" style={{ fontSize: 9 }}>{h}</div>
                ))}
                {/* Data rows - group by weekday */}
                {[...new Set(bt.hours.map(h => h.weekday))].sort().map(wd => (
                  <>
                    <div key={`label-${wd}`} className="heatmap-label">{WEEKDAYS[wd] ?? wd}</div>
                    {Array.from({ length: 24 }, (_, h) => {
                      const cell = bt.hours.find(x => x.weekday === wd && x.hour === h);
                      const sample = cell?.sample ?? 0;
                      const maxSample = Math.max(...bt.hours.map(x => x.sample), 1);
                      const intensity = sample / maxSample;
                      return (
                        <div
                          key={`${wd}-${h}`}
                          className="heatmap-cell"
                          title={`${WEEKDAYS[wd]} ${h}:00 · ${sample} 样本`}
                          style={{
                            background: sample > 0
                              ? `rgba(59,130,246,${0.1 + intensity * 0.8})`
                              : 'var(--bg-secondary)',
                            color: intensity > 0.5 ? 'white' : 'var(--text-muted)',
                            fontSize: 9,
                          }}
                        >
                          {sample > 0 ? sample : ''}
                        </div>
                      );
                    })}
                  </>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Learned examples */}
      {learned && (learned.learned_positive_patterns.length > 0 || learned.learned_negative_examples.length > 0) && (
        <div className="card">
          <div className="card-title">已学习样本</div>
          {learned.learned_positive_patterns.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600, marginBottom: 8 }}>
                ✓ 正样本 ({learned.learned_positive_patterns.length})
              </div>
              {learned.learned_positive_patterns.map((p, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', fontFamily: 'var(--font-mono)' }}>
                  {p.persona_id} · {p.outcome} · {p.days_to_outcome}天
                  {p.pain_point && ` · ${p.pain_point}`}
                </div>
              ))}
            </div>
          )}
          {learned.learned_negative_examples.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600, marginBottom: 8 }}>
                ✗ 负样本 ({learned.learned_negative_examples.length})
              </div>
              {learned.learned_negative_examples.map((_, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>—</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
