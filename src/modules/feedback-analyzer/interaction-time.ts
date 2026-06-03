/**
 * 互动时段分析（§3.11 回路 4：最佳互动时段）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 聚合各 persona 在不同时段/星期的互动响应率
 *   - 输出 BestInteractionTimes[]
 */

import type { LeadEvent, BestInteractionTimes } from '../../core/types.js';

const RESPONSIVE_STATUSES = new Set(['已互动', '已加好友', '已加微', '已预约', '已私信']);
const MIN_SAMPLES = 3;

export interface InteractionTimeResult {
  times: BestInteractionTimes[];
}

/**
 * 计算各 persona 的最佳互动时段
 */
export function computeInteractionTime(events: LeadEvent[]): InteractionTimeResult {
  const byPersona: Record<string, Map<string, { total: number; responses: number }>> = {};

  for (const e of events) {
    if (!e.persona) continue;
    if (!byPersona[e.persona]) byPersona[e.persona] = new Map();

    const date = new Date(e.interaction_time);
    if (isNaN(date.getTime())) continue; // 跳过无效时间（会产生 "NaN-NaN" 桶）
    // 用 UTC 而非 server local，避免时区漂移影响"最佳时段"判断
    const weekday = date.getUTCDay();
    const hour = date.getUTCHours();
    const key = `${weekday}-${hour}`;

    if (!byPersona[e.persona].has(key)) byPersona[e.persona].set(key, { total: 0, responses: 0 });
    const stat = byPersona[e.persona].get(key)!;
    stat.total++;
    if (e.to_status && RESPONSIVE_STATUSES.has(e.to_status as string)) {
      stat.responses++;
    }
  }

  const times: BestInteractionTimes[] = Object.entries(byPersona).map(([persona, buckets]) => {
    const filtered = [...buckets.entries()]
      .filter(([_, s]) => s.total >= MIN_SAMPLES)
      .map(([key, s]) => {
        const [w, h] = key.split('-').map(Number);
        return { weekday: w, hour: h, rate: s.responses / s.total, sample: s.total };
      })
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 3);

    return { persona, hours: filtered };
  });

  return { times };
}