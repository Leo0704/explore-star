/**
 * 钩子风格归因（§3.11 回路 2：钩子风格 A/B）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 聚合各风格的回复率/成交率
 *   - 输出 HookStylePerformance[]
 */
import type { LeadEvent, HookStylePerformance } from '../../core/types.js';
export interface HookStyleAttributionResult {
    performance: HookStylePerformance[];
    bestStyle: string | null;
}
/**
 * 计算各钩子风格的回复率
 */
export declare function computeHookStyleAttribution(events: LeadEvent[]): HookStyleAttributionResult;
