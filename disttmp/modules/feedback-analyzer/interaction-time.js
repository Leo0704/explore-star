/**
 * 互动时段分析（§3.11 回路 4：最佳互动时段）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 聚合各 persona 在不同时段/星期的互动响应率
 *   - 输出 BestInteractionTimes[]
 */
const RESPONSIVE_STATUSES = new Set(['已互动', '已加好友', '已加微', '已预约', '已成交', '已私信']);
const MIN_SAMPLES = 3;
/**
 * 计算各 persona 的最佳互动时段
 */
export function computeInteractionTime(events) {
    const byPersona = {};
    for (const e of events) {
        if (!e.persona)
            continue;
        if (!byPersona[e.persona])
            byPersona[e.persona] = new Map();
        const date = new Date(e.interaction_time);
        const weekday = date.getDay();
        const hour = date.getHours();
        const key = `${weekday}-${hour}`;
        if (!byPersona[e.persona].has(key))
            byPersona[e.persona].set(key, { total: 0, responses: 0 });
        const stat = byPersona[e.persona].get(key);
        stat.total++;
        if (e.to_status && RESPONSIVE_STATUSES.has(e.to_status)) {
            stat.responses++;
        }
    }
    const times = Object.entries(byPersona).map(([persona, buckets]) => {
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
//# sourceMappingURL=interaction-time.js.map