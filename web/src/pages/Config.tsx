import { useCallback, useState } from 'react';
import { api, type BusinessConfig } from '../api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { usePolling } from '../hooks/usePolling';

function ConfigRow({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === '') return null;
  const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return (
    <div className="config-row">
      <span className="config-key">{label}</span>
      <span className="config-val">{display}</span>
    </div>
  );
}

function Section({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  if (!data) return null;
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      {Object.entries(data).map(([k, v]) => <ConfigRow key={k} label={k} value={v} />)}
    </div>
  );
}

function BusinessSection({ biz }: { biz: BusinessConfig }) {
  const [tab, setTab] = useState<'profile' | 'channels' | 'conversion' | 'crm'>('profile');

  const profile = biz.profile as Record<string, unknown> | null;
  const channels = biz.channels as Record<string, unknown> | null;
  const conversion = biz.conversion as Record<string, unknown> | null;
  const crm = biz.crm as Record<string, unknown> | null;

  const businessInfo = profile?.business as Record<string, unknown> | undefined;
  const llm = profile?.llm as Record<string, unknown> | undefined;
  const personas = profile?.target_personas as Array<Record<string, unknown>> | undefined;
  const intentSignals = profile?.intent_signals as string[] | undefined;

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{biz.name}</div>

      <div className="section-tabs">
        {(['profile', 'channels', 'conversion', 'crm'] as const).map(t => (
          <button key={t} className={`section-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'profile' ? '业务画像' : t === 'channels' ? '渠道配置' : t === 'conversion' ? '转化配置' : 'CRM'}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div>
          {businessInfo && (
            <div className="card">
              <div className="card-title">业务信息</div>
              <ConfigRow label="名称" value={businessInfo.name} />
              <ConfigRow label="价值主张" value={businessInfo.value_prop} />
              <ConfigRow label="描述" value={businessInfo.description} />
            </div>
          )}

          {personas && personas.length > 0 && (
            <div className="card">
              <div className="card-title">目标人设</div>
              {personas.map((p, i) => (
                <div key={i} className="persona-card" style={{ marginBottom: 10 }}>
                  <div className="persona-name">{p.name as string}</div>
                  {p.description ? <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{String(p.description)}</div> : null}
                  {p.value_score != null && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>
                      价值评分: {String(p.value_score)}
                    </div>
                  )}
                  {p.typical_pain_points && Array.isArray(p.typical_pain_points) ? (
                    <div style={{ marginTop: 6 }}>
                      {(p.typical_pain_points as string[]).map((pp, j) => (
                        <div key={j} style={{ fontSize: 11, color: 'var(--text-muted)', padding: '1px 0' }}>· {String(pp)}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {intentSignals && intentSignals.length > 0 && (
            <div className="card">
              <div className="card-title">意图信号词</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {intentSignals.map(s => (
                  <span key={s} className="badge badge-info">{s}</span>
                ))}
              </div>
            </div>
          )}

          {llm && (
            <div className="card">
              <div className="card-title">LLM 配置</div>
              <ConfigRow label="Provider" value={llm.provider} />
              <ConfigRow label="Model" value={llm.model} />
              <ConfigRow label="API Key 环境变量" value={llm.api_key_env} />
              <ConfigRow label="Base URL" value={llm.base_url} />
              <ConfigRow label="Temperature" value={llm.temperature} />
              <ConfigRow label="Max Tokens" value={llm.max_tokens} />
            </div>
          )}
        </div>
      )}

      {tab === 'channels' && <Section title="渠道配置" data={channels} />}
      {tab === 'conversion' && <Section title="转化配置" data={conversion} />}
      {tab === 'crm' && <Section title="CRM 配置" data={crm} />}
    </div>
  );
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function Config() {
  const [businesses, setBusinesses] = useState<BusinessConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await api.getConfig();
      setBusinesses(r.businesses);
      setError(null);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(reload, 5000);

  if (loading) return <LoadingSpinner />;

  if (businesses.length === 0) return (
    <div>
      <div className="page-header"><div className="page-title">配置查看</div></div>
      <div className="empty"><div className="empty-icon">⚙</div>未找到业务配置目录，请先运行 init 命令</div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-title">配置查看</div>
        <div className="page-subtitle">{businesses.length} 个业务配置</div>
      </div>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {businesses.map(biz => <BusinessSection key={biz.name} biz={biz} />)}
    </div>
  );
}
