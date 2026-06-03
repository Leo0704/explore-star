/**
 * 智能放弃判定（§3.6.3）
 *
 * 3 次 0 回应 + opt_out 检测
 */

import type { Lead } from '../../core/types.js';

// ---------------------------------------------------------------------------
// 拒绝信号词列表
// ---------------------------------------------------------------------------

// 4+ 字中文：子串匹配即可（误报风险低）
const REJECT_SIGNALS_EXACT = [
  '不需要',
];

// 短中文（≤3 字）+ 英文：必须 word-boundary 匹配
// 避免 "stop" 子串误中 "unstoppable"，"不要" 误中相邻短语
const REJECT_SIGNALS_BOUNDARY = [
  '别发了', '别再发', '拉黑', '不要', '没兴趣', '不用了',
  'stop', 'unsubscribe',
];
const REJECT_SIGNAL_BOUNDARY_REGEX = new RegExp(
  `(?:^|\\b)(${REJECT_SIGNALS_BOUNDARY.join('|')})(?:$|\\b)`,
  'i',
);

// ---------------------------------------------------------------------------
// opt_out 检测
// ---------------------------------------------------------------------------

/**
 * 检查回复内容是否包含拒绝信号
 */
export function checkOptOut(responseText: string | undefined | null): boolean {
  if (!responseText) return false;
  if (REJECT_SIGNALS_EXACT.some(signal => responseText.includes(signal))) return true;
  return REJECT_SIGNAL_BOUNDARY_REGEX.test(responseText);
}

// ---------------------------------------------------------------------------
// 智能放弃判定
// ---------------------------------------------------------------------------

export interface AbandonmentResult {
  shouldAbandon: boolean;
  reason?: string;
  newStatus?: '已流失' | '沉默';
}

/**
 * 判断 lead 是否应该被放弃/降级
 */
export function checkAbandonment(
  lead: Lead,
  noResponseLimit: number = 3,
  dormantDays: number = 30
): AbandonmentResult {
  // 显式拒绝 → 已流失
  if (checkOptOut(lead.last_response_text)) {
    return { shouldAbandon: true, reason: '客户显式拒绝', newStatus: '已流失' };
  }

  // 被拒 → 已流失
  if (lead.last_task_result === '被拒') {
    return { shouldAbandon: true, reason: '任务被拒', newStatus: '已流失' };
  }

  // 0 回应达到上限 → 已流失
  if (
    lead.execution_count >= noResponseLimit &&
    lead.response_count === 0 &&
    lead.status !== '已流失'
  ) {
    return { shouldAbandon: true, reason: '0 回应达到上限', newStatus: '已流失' };
  }

  // 已加微且沉默超过 dormantDays → 沉默
  if (lead.status === '已加微') {
    const lastInt = lead.last_interaction_at || lead.wechat_added_at || lead.created_at;
    const daysSince = (Date.now() - new Date(lastInt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > dormantDays) {
      return { shouldAbandon: true, reason: `加微 ${Math.round(daysSince)} 天未互动`, newStatus: '沉默' };
    }
  }

  // 60 天无任何动作 → 永久归档为已流失
  const allDaysSince = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (
    allDaysSince > 60 &&
    !['已成交', '已流失', '已再激活'].includes(lead.status)
  ) {
    return { shouldAbandon: true, reason: '60 天无动作', newStatus: '已流失' };
  }

  return { shouldAbandon: false };
}