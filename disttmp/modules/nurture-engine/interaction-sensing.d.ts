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
export declare function applyInteractionFeedback(lead: Lead, noResponseLimit?: number): InteractionFeedbackResult;
/**
 * 更新 lead 的互动统计
 */
export declare function recordInteraction(lead: Lead, result: '有回应' | '无回应' | '被拒' | '未执行', responseText?: string): void;
