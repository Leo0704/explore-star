/**
 * 互动时段分析（§3.11 回路 4：最佳互动时段）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 聚合各 persona 在不同时段/星期的互动响应率
 *   - 输出 BestInteractionTimes[]
 */
import type { LeadEvent, BestInteractionTimes } from '../../core/types.js';
export interface InteractionTimeResult {
    times: BestInteractionTimes[];
}
/**
 * 计算各 persona 的最佳互动时段
 */
export declare function computeInteractionTime(events: LeadEvent[]): InteractionTimeResult;
