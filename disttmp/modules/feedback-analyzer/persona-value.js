/**
 * Persona 价值归因（§3.11 回路 3：persona 价值排序）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 聚合各 persona 的 leads / conversions / revenue
 *   - 计算 value_score（0-10）
 *   - 输出 PersonaValue[]
 */
// 转换状态集合
const CONVERTED_STATUSES = new Set(['已成交', '已加微', '已预约', '已私信']);
/**
 * 计算各 persona 的价值评分
 */
export function computePersonaValue(events) {
    const byPersona = {};
    for (const e of events) {
        if (!e.persona)
            continue;
        if (!byPersona[e.persona])
            byPersona[e.persona] = { leads: new Set(), conversions: 0, revenue: 0 };
        byPersona[e.persona].leads.add(e.cid);
        if (e.to_status && CONVERTED_STATUSES.has(e.to_status)) {
            byPersona[e.persona].conversions++;
            // V1.4: 估算 revenue（实际从 CRM 读）
            byPersona[e.persona].revenue += 50_000;
        }
    }
    const values = Object.entries(byPersona).map(([persona, s]) => {
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
function round1(n) {
    return Math.round(n * 10) / 10;
}
//# sourceMappingURL=persona-value.js.map