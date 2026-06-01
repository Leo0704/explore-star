/**
 * 状态机模块（§3.6.1）
 *
 * STATE_TRANSITIONS 常量 + 状态转移逻辑
 */
import type { Lead, LeadStatus, Task, TaskAction, BusinessProfile } from '../../core/types.js';
export interface Transition {
    action: TaskAction;
    new_state: LeadStatus;
    hookType: 'reply' | 'dm' | null;
    condition: ((lead: Lead) => boolean) | null;
}
export declare const STATE_TRANSITIONS: Record<string, Transition>;
/**
 * 根据 lead 当前状态 + 转移表，决定下一步任务
 * @returns Task 或 null（该 lead 今天没有可执行的任务）
 */
export declare function buildTask(lead: Lead, profile: BusinessProfile, generateHookFn?: (profile: BusinessProfile, lead: Lead, hookType: 'reply' | 'dm') => Promise<string>): Task | null;
export declare function nextActionForState(status: LeadStatus): TaskAction | null;
export declare function markStatus(lead: Lead, to: LeadStatus, note?: string): void;
