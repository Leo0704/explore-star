/**
 * 钩子风格归因（§3.11 回路 2：钩子风格 A/B）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 聚合各风格的回复率/成交率
 *   - 输出 HookStylePerformance[]
 */

import type { LeadEvent, HookStylePerformance } from '../../core/types.js';

const RESPONSIVE_STATUSES = new Set(['已互动', '已加好友', '已加微', '已预约', '已成交', '已私信']);

export interface HookStyleAttributionResult {
  performance: HookStylePerformance[];
  bestStyle: string | null;
}

/**
 * 计算各钩子风格的回复率
 */
export function computeHookStyleAttribution(events: LeadEvent[]): HookStyleAttributionResult {
  const byStyle: Record<string, { tested: Set<string>; replied: number; converted: number }> = {};

  for (const e of events) {
    if (!e.hook_style) continue;
    if (!byStyle[e.hook_style]) byStyle[e.hook_style] = { tested: new Set(), replied: 0, converted: 0 };
    byStyle[e.hook_style].tested.add(e.cid);
    if (e.to_status && RESPONSIVE_STATUSES.has(e.to_status as string)) {
      byStyle[e.hook_style].replied++;
    }
    if (e.to_status === '已成交') {
      byStyle[e.hook_style].converted++;
    }
  }

  const performance: HookStylePerformance[] = Object.entries(byStyle).map(([style, s]) => ({
    style,
    tested: s.tested.size,
    replied: s.replied,
    rate: s.tested.size > 0 ? s.replied / s.tested.size : 0,
  }));

  // 取回复率最高的风格
  const sorted = [...performance].sort((a, b) => b.rate - a.rate);
  const bestStyle = sorted.length > 0 ? sorted[0].style : null;

  return { performance, bestStyle };
}