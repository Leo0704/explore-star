/**
 * 关键词归因（§3.11 回路 1：关键词权重）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 聚合关键词转化数据
 *   - 贝叶斯平滑计算建议权重
 *   - 输出 KeywordPerformance[]
 */
import type { LeadEvent, KeywordPerformance } from '../../core/types.js';
export interface KeywordAttributionResult {
    performance: KeywordPerformance[];
    globalRate: number;
    totalLeads: number;
    totalConversions: number;
}
/**
 * 计算关键词转化效果
 */
export declare function computeKeywordAttribution(events: LeadEvent[]): KeywordAttributionResult;
