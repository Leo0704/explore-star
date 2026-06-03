import type { Lead, LeadStatus, Task, TaskAction, BusinessProfile } from '../../core/types.js';

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
    hookType: null,
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
    hookType: null,
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
    hookType: null,
    condition: null,
  },
};

export function buildTask(
  lead: Lead,
  profile: BusinessProfile,
  _generateHookFn?: (profile: BusinessProfile, lead: Lead, hookType: 'reply' | 'dm') => string | Promise<string>
): Task | null {
  if (lead.opt_out) return null;
  if (lead.status === '已流失') return null;
  if (lead.status === '已成交') return null;
  if (lead.status === '已加微') return null;

  if (lead.last_task_executed_at) {
    const hoursSinceLastTask = (Date.now() - new Date(lead.last_task_executed_at).getTime()) / 3600000;
    if (hoursSinceLastTask < 24) return null;
  }

  const transition = STATE_TRANSITIONS[lead.status];
  if (!transition) return null;

  if (transition.condition && !transition.condition(lead)) return null;

  let hook = '';
  if (transition.hookType) {
    hook = transition.hookType === 'reply'
      ? (lead.suggested_reply_hook ?? '')
      : (lead.suggested_dm_hook ?? '');
  }

  return {
    task_id: crypto.randomUUID(),
    lead_cid: lead.cid,
    nickname: lead.nickname,
    current_state: lead.status,
    next_action: transition.action,
    hook,
    hook_style: lead.hook_style ?? 'default',
    priority: lead.intent_score > 0.85 ? 'high' : lead.intent_score > 0.7 ? 'medium' : 'low',
    persona: lead.persona,
    scheduled_at: '',
    reason: `状态 ${lead.status} → ${transition.new_state}`,
    source_keyword: lead.source_keyword ?? lead.keyword,
  };
}

