/**
 * 触达方式归因（§3.11 回路 5：触达方式效果）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 读取 touchpoint 相关事件
 *   - 统计各触达类型（send_pdf / send_booking_link / send_followup / reactivate）的转化效果
 *   - 输出 touchpoint_performance[]
 */
/**
 * 从 touchpoint_sent / touchpoint_result 事件计算触达效果
 */
export function computeTouchpointAttribution(events) {
    const byType = {};
    for (const e of events) {
        // 跳过非 touchpoint 事件
        if (e.event !== 'touchpoint_sent' && e.event !== 'touchpoint_result')
            continue;
        const type = e.touchpoint_type ?? 'unknown';
        if (!byType[type])
            byType[type] = { sent: 0, opened: 0, replied: 0, booked: 0, no_response: 0 };
        if (e.event === 'touchpoint_sent') {
            byType[type].sent++;
        }
        else if (e.event === 'touchpoint_result') {
            const result = e.touchpoint_result;
            if (result === 'opened')
                byType[type].opened++;
            else if (result === 'replied')
                byType[type].replied++;
            else if (result === 'booked')
                byType[type].booked++;
            else if (result === 'no_response')
                byType[type].no_response++;
        }
    }
    const performance = Object.entries(byType).map(([type, s]) => ({
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
//# sourceMappingURL=touchpoint-attribution.js.map