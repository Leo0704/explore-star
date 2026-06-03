import type { LeadEvent, BestInteractionTimes } from '../../core/types.js';

const RESPONSIVE_STATUSES = new Set(['已互动', '已加好友', '已加微', '已预约', '已私信']);
const MIN_SAMPLES = 3;

export interface InteractionTimeResult {
  times: BestInteractionTimes[];
}

export function computeInteractionTime(events: LeadEvent[]): InteractionTimeResult {
  const byPersona: Record<string, Map<string, { total: number; responses: number }>> = {};

  for (const e of events) {
    if (!e.persona) continue;
    if (!byPersona[e.persona]) byPersona[e.persona] = new Map();

    const date = new Date(e.interaction_time);
    if (isNaN(date.getTime())) continue;
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