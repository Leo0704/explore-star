import type { Task } from '../../core/types.js';

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
