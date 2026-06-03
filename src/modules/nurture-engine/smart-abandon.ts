import type { Lead } from '../../core/types.js';

const REJECT_SIGNALS_EXACT = [
  '不需要', '别发了', '别再发', '拉黑', '没兴趣', '不用了',
];

const REJECT_SIGNALS_BOUNDARY = [
  '不要', 'stop', 'unsubscribe',
];
const REJECT_SIGNAL_BOUNDARY_REGEX = new RegExp(
  `(?:^|(?<=[^\\u4e00-\\u9fff]))(${REJECT_SIGNALS_BOUNDARY.join('|')})(?=$|(?=[^\\u4e00-\\u9fff]))`,
  'i',
);

export function checkOptOut(responseText: string | undefined | null): boolean {
  if (!responseText) return false;
  if (REJECT_SIGNALS_EXACT.some(signal => responseText.includes(signal))) return true;
  return REJECT_SIGNAL_BOUNDARY_REGEX.test(responseText);
}

export interface AbandonmentResult {
  shouldAbandon: boolean;
  reason?: string;
  newStatus?: '已流失' | '沉默';
}

export function checkAbandonment(
  lead: Lead,
  noResponseLimit: number = 3,
  dormantDays: number = 30
): AbandonmentResult {
  if (checkOptOut(lead.last_response_text)) {
    return { shouldAbandon: true, reason: '客户显式拒绝', newStatus: '已流失' };
  }

  if (lead.last_task_result === '被拒') {
    return { shouldAbandon: true, reason: '任务被拒', newStatus: '已流失' };
  }

  if (
    lead.execution_count >= noResponseLimit &&
    lead.response_count === 0 &&
    lead.status !== '已流失'
  ) {
    return { shouldAbandon: true, reason: '0 回应达到上限', newStatus: '已流失' };
  }

  if (lead.status === '已加微') {
    const lastInt = lead.last_interaction_at || lead.wechat_added_at || lead.created_at;
    const daysSince = (Date.now() - new Date(lastInt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > dormantDays) {
      return { shouldAbandon: true, reason: `加微 ${Math.round(daysSince)} 天未互动`, newStatus: '沉默' };
    }
  }

  const allDaysSince = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (
    allDaysSince > 60 &&
    !['已成交', '已流失', '已再激活'].includes(lead.status)
  ) {
    return { shouldAbandon: true, reason: '60 天无动作', newStatus: '已流失' };
  }

  return { shouldAbandon: false };
}