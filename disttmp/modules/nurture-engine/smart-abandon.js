/**
 * 智能放弃判定（§3.6.3）
 *
 * 3 次 0 回应 + opt_out 检测
 */
// ---------------------------------------------------------------------------
// 拒绝信号词列表
// ---------------------------------------------------------------------------
const REJECT_SIGNALS = [
    '不需要', '别发了', '别再发', '拉黑', '不要', '没兴趣', '不用了',
    'stop', 'unsubscribe',
];
// ---------------------------------------------------------------------------
// opt_out 检测
// ---------------------------------------------------------------------------
/**
 * 检查回复内容是否包含拒绝信号
 */
export function checkOptOut(responseText) {
    if (!responseText)
        return false;
    return REJECT_SIGNALS.some(signal => responseText.includes(signal));
}
/**
 * 判断 lead 是否应该被放弃/降级
 */
export function checkAbandonment(lead, noResponseLimit = 3, dormantDays = 30) {
    // 显式拒绝 → 已流失
    if (checkOptOut(lead.last_response_text)) {
        return { shouldAbandon: true, reason: '客户显式拒绝', newStatus: '已流失' };
    }
    // 被拒 → 已流失
    if (lead.last_task_result === '被拒') {
        return { shouldAbandon: true, reason: '任务被拒', newStatus: '已流失' };
    }
    // 0 回应达到上限 → 已流失
    if (lead.execution_count >= noResponseLimit &&
        lead.response_count === 0 &&
        lead.status !== '已流失') {
        return { shouldAbandon: true, reason: '0 回应达到上限', newStatus: '已流失' };
    }
    // 已加微且沉默超过 dormantDays → 沉默
    if (lead.status === '已加微') {
        const lastInt = lead.last_interaction_at || lead.wechat_added_at || lead.created_at;
        const daysSince = (Date.now() - new Date(lastInt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince > dormantDays) {
            return { shouldAbandon: true, reason: `加微 ${Math.round(daysSince)} 天未互动`, newStatus: '沉默' };
        }
    }
    // 60 天无任何动作 → 永久归档为已流失
    const allDaysSince = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (allDaysSince > 60 &&
        !['已成交', '已流失', '已再激活'].includes(lead.status)) {
        return { shouldAbandon: true, reason: '60 天无动作', newStatus: '已流失' };
    }
    return { shouldAbandon: false };
}
//# sourceMappingURL=smart-abandon.js.map