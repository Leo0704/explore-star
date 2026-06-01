/**
 * 再激活队列（§3.6.4）
 *
 * 30 天沉默池 → 每月 1 日轻量触达
 */

import type { Lead, Task } from '../../core/types.js';

export interface ReactivationOptions {
  dormantDays?: number;
  maxAttempts?: number;
  messageTemplate?: string;
}

const DEFAULT_DORMANT_DAYS = 30;
const DEFAULT_MAX_ATTEMPTS = 1;

/**
 * 查找可再激活的 leads（沉默状态超过 dormantDays）
 */
export function findReactivatableLeads(
  leads: Lead[],
  dormantDays: number = DEFAULT_DORMANT_DAYS
): Lead[] {
  const cutoffMs = dormantDays * 24 * 60 * 60 * 1000;
  return leads.filter(l => {
    if (l.status !== '沉默') return false;
    const lastInt = l.last_interaction_at || l.wechat_added_at || l.created_at;
    return Date.now() - new Date(lastInt).getTime() > cutoffMs;
  });
}

/**
 * 生成再激活任务
 */
export function reactivate(lead: Lead, opts: ReactivationOptions = {}): Task {
  const template = opts.messageTemplate ?? 'X 总，上次说的方案考虑得怎样？';

  return {
    task_id: crypto.randomUUID(),
    lead_cid: lead.cid,
    nickname: lead.nickname,
    current_state: '沉默',
    next_action: 'dm',
    hook: template,
    hook_style: '轻量触达',
    priority: 'low',
    persona: lead.persona,
    scheduled_at: new Date().toISOString(),
    reason: '沉默客户再激活',
  };
}

/**
 * 检查 lead 是否已达最大再激活次数
 */
export function canReactivate(lead: Lead, maxAttempts: number = DEFAULT_MAX_ATTEMPTS): boolean {
  // Lead 上没有 attempts 字段，这里做个简单实现
  // 实际应该从 lead.custom_fields 或专门的 reactivation 记录中读取
  const attempts = (lead as any).reactivation_attempts ?? 0;
  return attempts < maxAttempts;
}

/**
 * 记录再激活尝试
 */
export function recordReactivationAttempt(lead: Lead): void {
  (lead as any).reactivation_attempts = ((lead as any).reactivation_attempts ?? 0) + 1;
  (lead as any).last_reactivation_at = new Date().toISOString();
}