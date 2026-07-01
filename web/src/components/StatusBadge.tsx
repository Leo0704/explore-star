import type { HealthStatus, StepStatus } from '../api';

const STATUS_LABELS: Record<string, string> = {
  ok: '正常', warning: '警告', critical: '严重', error: '错误',
  completed: '完成', failed: '失败', running: '运行中', pending: '等待中',
  login_required: '需要登录',
};

export function StatusBadge({ status }: { status: HealthStatus | StepStatus | string }) {
  const cls = ['ok', 'completed'].includes(status) ? 'badge-ok'
    : ['warning', 'running'].includes(status) ? 'badge-warning'
    : ['critical', 'failed', 'error', 'login_required'].includes(status) ? 'badge-failed'
    : 'badge-pending';

  return <span className={`badge ${cls}`}>{STATUS_LABELS[status] ?? status}</span>;
}
