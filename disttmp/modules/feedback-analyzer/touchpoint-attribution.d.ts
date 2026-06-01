/**
 * 触达方式归因（§3.11 回路 5：触达方式效果）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 读取 touchpoint 相关事件
 *   - 统计各触达类型（send_pdf / send_booking_link / send_followup / reactivate）的转化效果
 *   - 输出 touchpoint_performance[]
 */
import type { LeadEvent } from '../../core/types.js';
export interface TouchpointPerformance {
    action_type: string;
    sent: number;
    opened: number;
    replied: number;
    booked: number;
    no_response: number;
    conversion_rate: number;
}
export interface TouchpointAttributionResult {
    performance: TouchpointPerformance[];
    bestChannel: string | null;
}
/**
 * 从 touchpoint_sent / touchpoint_result 事件计算触达效果
 */
export declare function computeTouchpointAttribution(events: LeadEvent[]): TouchpointAttributionResult;
