/**
 * 关键词归因（§3.11 回路 1：关键词权重）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 聚合关键词转化数据
 *   - 贝叶斯平滑计算建议权重
 *   - 输出 KeywordPerformance[]
 */

import type { LeadEvent, KeywordPerformance } from '../../core/types.js';

const BAYESIAN_ALPHA = 10;
const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 2.0;
const NEUTRAL_WEIGHT = 1.0;

export interface KeywordAttributionResult {
  performance: KeywordPerformance[];
  globalRate: number;
  totalLeads: number;
  totalConversions: number;
}

/**
 * 计算关键词转化效果
 */
export function computeKeywordAttribution(events: LeadEvent[]): KeywordAttributionResult {
  const byKeyword: Record<string, { leads: Set<string>; conversions: number }> = {};

  for (const e of events) {
    if (!e.keyword) continue;
    if (!byKeyword[e.keyword]) byKeyword[e.keyword] = { leads: new Set(), conversions: 0 };
    byKeyword[e.keyword].leads.add(e.cid);
    if (e.to_status === '已成交') byKeyword[e.keyword].conversions++;
  }

  const totalLeads = Object.values(byKeyword).reduce((s, k) => s + k.leads.size, 0);
  const totalConversions = Object.values(byKeyword).reduce((s, k) => s + k.conversions, 0);
  const globalRate = totalLeads > 0 ? totalConversions / totalLeads : 0;

  const performance: KeywordPerformance[] = Object.entries(byKeyword).map(([keyword, stats]) => {
    const n = stats.leads.size;
    const c = stats.conversions;
    const rate = n > 0 ? c / n : 0;
    const smoothed = (c + BAYESIAN_ALPHA * globalRate) / (n + BAYESIAN_ALPHA);
    const proposed = proposeWeight(NEUTRAL_WEIGHT, smoothed, globalRate);
    const autoApply = Math.abs(proposed - NEUTRAL_WEIGHT) / NEUTRAL_WEIGHT < 0.20;

    return {
      keyword,
      leads: n,
      conversions: c,
      rate,
      smoothed_rate: smoothed,
      weight: NEUTRAL_WEIGHT,
      suggested_weight: round2(proposed),
      auto_apply: autoApply,
    };
  });

  return { performance, globalRate, totalLeads, totalConversions };
}

function proposeWeight(current: number, smoothed: number, global: number): number {
  const ratio = smoothed / Math.max(global, 0.001);
  const proposed = current * Math.sqrt(ratio);
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, proposed));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}