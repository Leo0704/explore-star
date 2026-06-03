import type { LeadEvent, PersonaValue } from '../../core/types.js';

const CONVERTED_STATUSES = new Set(['已成交']);

export interface PersonaValueResult {
  values: PersonaValue[];
  ranking: Array<{ persona: string; value_score: number }>;
}

export function computePersonaValue(events: LeadEvent[]): PersonaValueResult {
  const byPersona: Record<string, { leads: Set<string>; conversions: number; revenue: number }> = {};

  for (const e of events) {
    if (!e.persona) continue;
    if (!byPersona[e.persona]) byPersona[e.persona] = { leads: new Set(), conversions: 0, revenue: 0 };
    byPersona[e.persona].leads.add(e.cid);
    if (e.to_status && CONVERTED_STATUSES.has(e.to_status as string)) {
      byPersona[e.persona].conversions++;
      const rawRev = e.metadata?.revenue;
      const rev = typeof rawRev === 'number' ? rawRev : 0;
      byPersona[e.persona].revenue += rev;
    }
  }

  const values: PersonaValue[] = Object.entries(byPersona).map(([persona, s]) => {
    const conversionRate = s.leads.size > 0 ? s.conversions / s.leads.size : 0;
    const avgRevenue = s.conversions > 0 ? s.revenue / s.conversions : 0;
    const conversionScore = conversionRate * 10;
    const revenueScore = Math.min(10, Math.log10(avgRevenue + 1) * 2);
    const sampleScore = Math.min(10, Math.log10(s.leads.size + 1) * 3);
    const valueScore = round1(0.5 * conversionScore + 0.3 * revenueScore + 0.2 * sampleScore);

    return {
      persona,
      leads: s.leads.size,
      conversions: s.conversions,
      revenue: s.revenue,
      value_score: valueScore,
    };
  });

  const ranking = [...values]
    .sort((a, b) => b.value_score - a.value_score)
    .map(v => ({ persona: v.persona, value_score: v.value_score }));

  return { values, ranking };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}