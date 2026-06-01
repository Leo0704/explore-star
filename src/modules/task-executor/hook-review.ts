/**
 * 钩子审核模块（§3.6.5 可选钩子审核模式）
 *
 * 读取 config/hook_review 字段，true 时把 task 写入飞书/微信等多维表
 * 人工标记后再执行
 */

import type { Task } from '../../core/types.js';

export interface HookReviewResult {
  approved: boolean;
  modified_hook?: string;
  reason?: string;
}

/**
 * 钩子审核模式
 * V1 实现：直接批准（mock），留接口便于后续升级
 */
export async function reviewHook(
  task: Task,
  reviewConfig: boolean = false
): Promise<HookReviewResult> {
  if (!reviewConfig) {
    return { approved: true };
  }

  // TODO: 接入飞书/微信多维表审核 API
  // 1. 写入待审核任务到多维表（字段：cid/nickname/action/hook/hook_style/scheduled_at）
  // 2. 轮询审核状态（approved/modified/skipped）
  // 3. 返回审核结果

  // V1 mock：直接批准（不阻塞）
  // 真实实现应该：
  // - 同步等待：写入多维表后阻塞，直到人工标记
  // - 或异步模式：任务写入队列，后续编排器处理

  return { approved: true };
}

/**
 * 检查任务是否需要审核
 */
export function needsReview(task: Task, reviewConfig: boolean): boolean {
  // hook_review = true 时所有任务都需要审核
  return reviewConfig;
}

/**
 * 生成审核备注（用于多维表展示）
 */
export function generateReviewNote(task: Task): string {
  return [
    `客户：${task.nickname}`,
    `当前状态：${task.current_state}`,
    `动作：${task.next_action}`,
    `话术：${task.hook.slice(0, 50)}${task.hook.length > 50 ? '...' : ''}`,
    `风格：${task.hook_style}`,
    `优先级：${task.priority}`,
    `原因：${task.reason}`,
  ].join('\n');
}