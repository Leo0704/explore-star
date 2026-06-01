/**
 * 智能放弃判定（§3.6.3）
 *
 * 3 次 0 回应 + opt_out 检测
 */
import type { Lead } from '../../core/types.js';
/**
 * 检查回复内容是否包含拒绝信号
 */
export declare function checkOptOut(responseText: string | undefined | null): boolean;
export interface AbandonmentResult {
    shouldAbandon: boolean;
    reason?: string;
    newStatus?: '已流失' | '沉默';
}
/**
 * 判断 lead 是否应该被放弃/降级
 */
export declare function checkAbandonment(lead: Lead, noResponseLimit?: number, dormantDays?: number): AbandonmentResult;
