/**
 * 互动效果感知（§3.6.2）
 *
 * 监听 last_task_result，决定是否推进/降级/放弃
 */

import type { Lead } from '../../core/types.js';

export interface InteractionFeedbackResult {
  action: 'advance' | 'demote' | 'abandon' | 'continue';
  reason: string;
}

/**
 * 根据互动效果决定引擎行为
 */
export function applyInteractionFeedback(
  lead: Lead,
  noResponseLimit: number = 3
): InteractionFeedbackResult {
  // 被拒 → 立即降级
  if (lead.last_task_result === '被拒') {
    return { action: 'abandon', reason: '客户明确拒绝' };
  }

  // 无回应且达到上限 → 降级为已流失
  if (
    lead.last_task_result === '无回应' &&
    lead.execution_count >= noResponseLimit &&
    lead.response_count === 0
  ) {
    return { action: 'abandon', reason: `执行 ${lead.execution_count} 次 0 回应` };
  }

  // 有回应 → 推进
  if (lead.last_task_result === '有回应') {
    return { action: 'advance', reason: '客户有回应' };
  }

  // 无回应但未达上限 → 继续重试
  if (lead.last_task_result === '无回应') {
    return { action: 'continue', reason: '未达放弃上限，继续' };
  }

  // 默认继续
  return { action: 'continue', reason: '默认' };
}

/**
 * 更新 lead 的互动统计
 */
export function recordInteraction(
  lead: Lead,
  result: '有回应' | '无回应' | '被拒' | '未执行',
  responseText?: string
): void {
  lead.last_task_executed_at = new Date().toISOString();
  lead.last_task_result = result;
  if (responseText) {
    lead.last_response_text = responseText;
  }

  if (result === '有回应') {
    lead.response_count++;
  }

  lead.execution_count++;
}