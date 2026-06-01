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
export function computeTouchpointAttribution(events: LeadEvent[]): TouchpointAttributionResult {
  const byType: Record<string, { sent: number; opened: number; replied: number; booked: number; no_response: number }> = {};

  for (const e of events) {
    const type = (e as any).touchpoint_type ?? 'unknown';
    if (!byType[type]) byType[type] = { sent: 0, opened: 0, replied: 0, booked: 0, no_response: 0 };

    // Count based on presence of fields (touchpoint events have extra fields)
    if ((e as any).touchpoint_result) {
      const result = (e as any).touchpoint_result;
      if (result === 'opened') byType[type].opened++;
      else if (result === 'replied') byType[type].replied++;
      else if (result === 'booked') byType[type].booked++;
      else if (result === 'no_response') byType[type].no_response++;
    } else if ((e as any).touchpoint_type) {
      byType[type].sent++;
    }
  }

  const performance: TouchpointPerformance[] = Object.entries(byType).map(([type, s]) => ({
    action_type: type,
    sent: s.sent,
    opened: s.opened,
    replied: s.replied,
    booked: s.booked,
    no_response: s.no_response,
    conversion_rate: s.sent > 0 ? (s.booked + s.replied) / s.sent : 0,
  }));

  const sorted = [...performance].sort((a, b) => b.conversion_rate - a.conversion_rate);
  const bestChannel = sorted.length > 0 ? sorted[0].action_type : null;

  return { performance, bestChannel };
}