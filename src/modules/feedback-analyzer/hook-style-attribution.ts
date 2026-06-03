import type { LeadEvent, HookStylePerformance } from '../../core/types.js';

const REPLIED_STATUSES = new Set(['已互动', '已私信', '已加好友', '已加微']);
const CONVERTED_STATUSES = new Set(['已成交']);

export interface HookStyleAttributionResult {
  performance: HookStylePerformance[];
  bestStyle: string | null;
}

export function computeHookStyleAttribution(events: LeadEvent[]): HookStyleAttributionResult {
  const byStyle: Record<string, { tested: Set<string>; replied: Set<string>; converted: number }> = {};

  for (const e of events) {
    if (!e.hook_style) continue;
    if (!byStyle[e.hook_style]) byStyle[e.hook_style] = { tested: new Set(), replied: new Set(), converted: 0 };
    byStyle[e.hook_style].tested.add(e.cid);
    if (e.to_status && REPLIED_STATUSES.has(e.to_status as string)) {
      byStyle[e.hook_style].replied.add(e.cid);
    }
    if (e.to_status && CONVERTED_STATUSES.has(e.to_status as string)) {
      byStyle[e.hook_style].converted++;
    }
  }

  const performance: HookStylePerformance[] = Object.entries(byStyle).map(([style, s]) => ({
    style,
    tested: s.tested.size,
    replied: s.replied.size,
    rate: s.tested.size > 0 ? s.replied.size / s.tested.size : 0,
  }));

  const sorted = [...performance].sort((a, b) => b.rate - a.rate);
  const bestStyle = sorted.length > 0 ? sorted[0].style : null;

  return { performance, bestStyle };
}