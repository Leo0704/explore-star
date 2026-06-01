/**
 * 浏览器动作映射（§3.6.5）
 *
 * like/comment/friend/dm 四种 action 映射到浏览器操作
 */

import type { Task, TaskAction } from '../../core/types.js';
import type { ExecutionResult } from './index.js';

export type BrowserActionType = 'like' | 'follow' | 'comment' | 'friend_request' | 'dm' | 'send_material';

/**
 * TaskAction → BrowserActionType 映射
 */
export function mapActionToBrowser(task: Task): BrowserActionType {
  switch (task.next_action) {
    case 'like_and_follow': return 'like';  // 简化：实际应返回 ['like', 'follow']
    case 'comment_reply': return 'comment';
    case 'friend_request': return 'friend_request';
    case 'dm': return 'dm';
    case 'send_material': return 'send_material';
    default:
      throw new Error(`未知 action: ${task.next_action}`);
  }
}

/**
 * 执行浏览器动作（V1 mock）
 * 真实实现需要 puppeteer 或 opencli browser skill
 */
export async function executeBrowserAction(
  task: Task,
  chromeProfile?: string
): Promise<ExecutionResult> {
  const action = mapActionToBrowser(task);

  // V1 mock：500ms 延迟模拟浏览器操作
  await new Promise(resolve => setTimeout(resolve, 500));

  const result: ExecutionResult = {
    task_id: task.task_id,
    lead_cid: task.lead_cid,
    action: task.next_action,
    result: 'executed_with_response',
    executed_at: new Date().toISOString(),
  };

  // 模拟风控检测（5% 概率触发）
  if (Math.random() < 0.05) {
    result.result = 'failed_risk';
    result.risk_signal = {
      type: 'rate_limit',
      count: 1,
      action: 'pause_1h',
    };
  }

  return result;
}

/**
 * 解析视频 URL 获取 aweme_id
 */
export function extractAwemeId(videoUrl: string): string {
  const match = videoUrl.match(/\/video\/(\d+)/);
  return match ? match[1] : '';
}

/**
 * 构造用户主页 URL
 */
export function buildUserProfileUrl(userUid: string): string {
  return `https://www.douyin.com/user/${userUid}`;
}