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
/**
 * 查找可再激活的 leads（沉默状态超过 dormantDays）
 */
export declare function findReactivatableLeads(leads: Lead[], dormantDays?: number): Lead[];
/**
 * 生成再激活任务
 */
export declare function reactivate(lead: Lead, opts?: ReactivationOptions): Task;
/**
 * 检查 lead 是否已达最大再激活次数
 */
export declare function canReactivate(lead: Lead, maxAttempts?: number): boolean;
/**
 * 记录再激活尝试
 */
export declare function recordReactivationAttempt(lead: Lead): void;
