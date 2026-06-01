/**
 * 状态机模块（§3.6.1）
 *
 * STATE_TRANSITIONS 常量 + 状态转移逻辑
 */

import type { Lead, LeadStatus, Task, TaskAction, BusinessProfile } from '../../core/types.js';

// ---------------------------------------------------------------------------
// 状态转移表
// ---------------------------------------------------------------------------

export interface Transition {
  action: TaskAction;
  new_state: LeadStatus;
  hookType: 'reply' | 'dm' | null;
  condition: ((lead: Lead) => boolean) | null;
}

export const STATE_TRANSITIONS: Record<string, Transition> = {
  '新发现': {
    action: 'like_and_follow',
    new_state: '已关注',
    hookType: null,  // 点赞+关注不需要话术
    condition: null,
  },
  '已关注': {
    action: 'comment_reply',
    new_state: '已互动',
    hookType: 'reply',
    condition: null,
  },
  '已互动': {
    action: 'friend_request',
    new_state: '已加好友',
    hookType: null,  // 好友申请不需要话术
    condition: (lead) => lead.last_task_result === '有回应',
  },
  '已加好友': {
    action: 'dm',
    new_state: '已私信',
    hookType: 'dm',
    condition: null,
  },
  '已私信': {
    action: 'send_material',
    new_state: '已加微',
    hookType: null,  // 物料内容由 conversion.yaml 决定
    condition: null,
  },
};

// ---------------------------------------------------------------------------
// 构建任务
// ---------------------------------------------------------------------------

/**
 * 根据 lead 当前状态 + 转移表，决定下一步任务
 * @returns Task 或 null（该 lead 今天没有可执行的任务）
 */
export function buildTask(
  lead: Lead,
  profile: BusinessProfile,
  _generateHookFn?: (profile: BusinessProfile, lead: Lead, hookType: 'reply' | 'dm') => string | Promise<string>
): Task | null {
  // 0. 前置检查
  if ((lead as any).opt_out) return null;
  if (lead.status === '已流失') return null;
  if (lead.status === '已成交') return null;
  if (lead.status === '已加微') return null;  // 交给 §3.10 转化引擎

  // 1. 检查 24h 冷却期
  if (lead.last_task_executed_at) {
    const hoursSinceLastTask = (Date.now() - new Date(lead.last_task_executed_at).getTime()) / 3600000;
    if (hoursSinceLastTask < 24) return null;
  }

  // 2. 状态转移
  const transition = STATE_TRANSITIONS[lead.status];
  if (!transition) return null;

  // 3. 检查转移条件
  if (transition.condition && !transition.condition(lead)) return null;

  // 4. 生成钩子（同步方式，不使用 async hook fn）
  let hook = '';
  if (transition.hookType) {
    hook = transition.hookType === 'reply'
      ? (lead.suggested_reply_hook ?? '')
      : (lead.suggested_dm_hook ?? '');
  }

  // 5. 构建任务
  return {
    task_id: crypto.randomUUID(),
    lead_cid: lead.cid,
    nickname: lead.nickname,
    current_state: lead.status,
    next_action: transition.action,
    hook,
    hook_style: (lead as any).hook_style ?? 'default',
    priority: lead.intent_score > 0.85 ? 'high' : lead.intent_score > 0.7 ? 'medium' : 'low',
    persona: lead.persona,
    scheduled_at: '',  // 由 generateDailyTasks 填充
    reason: `状态 ${lead.status} → ${transition.new_state}`,
  };
}

// ---------------------------------------------------------------------------
// 下一动作
// ---------------------------------------------------------------------------

export function nextActionForState(status: LeadStatus): TaskAction | null {
  switch (status) {
    case '新发现': return 'like_and_follow';
    case '已关注': return 'comment_reply';
    case '已互动': return 'friend_request';
    case '已加好友': return 'dm';
    case '已私信': return 'send_material';
    case '已加微': return null;  // 交给 §3.10 转化引擎
    case '已预约': return null;  // 等待客户回访
    case '沉默': return 'dm';  // 再激活
    case '已再激活': return 'dm';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// 状态标记
// ---------------------------------------------------------------------------

export function markStatus(lead: Lead, to: LeadStatus, note?: string): void {
  if (lead.status === to) return;
  const from = lead.status;
  lead.status = to;
  lead.status_history.push({ from, to, at: new Date().toISOString(), note });
  (lead as any).updated_at = new Date().toISOString();
}