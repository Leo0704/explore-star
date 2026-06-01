/**
 * 调度器（§3.6.1 + §3.11 回路 3/4）
 *
 * 按 persona 价值排序 + 最佳时段排程
 */
// ---------------------------------------------------------------------------
// 最佳时段（冷启动 fallback）
// ---------------------------------------------------------------------------
const DEFAULT_BEST_HOUR = 9;
const DEFAULT_BEST_MINUTE = 30;
/**
 * 从 weekly-insights.json 读取 persona 的最佳时段
 * 冷启动时返回默认时段
 */
export function getBestInteractionTime(insights, personaId) {
    if (insights?.best_interaction_times) {
        const match = insights.best_interaction_times.find(b => b.persona === personaId);
        if (match?.hours.length) {
            // 取回复率最高的小时
            const best = match.hours.reduce((a, b) => (a.rate ?? 0) > (b.rate ?? 0) ? a : b);
            return {
                weekday: best.weekday,
                hour: best.hour,
                minute: best.minute ?? DEFAULT_BEST_MINUTE,
            };
        }
    }
    // 冷启动 fallback
    return {
        weekday: 1, // 周一
        hour: DEFAULT_BEST_HOUR,
        minute: DEFAULT_BEST_MINUTE,
    };
}
/**
 * 计算任务 scheduled_at（最佳时段）
 */
export function scheduleTask(task, bestTime, baseDate = new Date()) {
    const scheduled = new Date(baseDate);
    scheduled.setDate(scheduled.getDate() + ((bestTime.weekday - scheduled.getDay() + 7) % 7));
    scheduled.setHours(bestTime.hour, bestTime.minute, 0, 0);
    // 如果已过当天，移到下周
    if (scheduled.getTime() <= baseDate.getTime()) {
        scheduled.setDate(scheduled.getDate() + 7);
    }
    return {
        ...task,
        scheduled_at: scheduled.toISOString(),
    };
}
// ---------------------------------------------------------------------------
// Persona 价值排序
// ---------------------------------------------------------------------------
/**
 * 获取 persona 价值分
 */
export function getPersonaValue(profile, insights, personaId) {
    // 先从 insights 读
    if (insights?.persona_value) {
        const match = insights.persona_value.find(p => p.persona === personaId);
        if (match)
            return match.value_score;
    }
    // 再从 profile 读
    const match = profile.target_personas.find(p => p.id === personaId);
    return match?.value_score ?? 5.0;
}
/**
 * 按 persona 价值降序排序 leads
 */
export function sortByPersonaValue(leads, profile, insights) {
    return [...leads].sort((a, b) => {
        const scoreA = getPersonaValue(profile, insights, a.persona);
        const scoreB = getPersonaValue(profile, insights, b.persona);
        return scoreB - scoreA;
    });
}
// ---------------------------------------------------------------------------
// 调度主函数
// ---------------------------------------------------------------------------
export function scheduleDailyTasks(tasks, profile, insights, baseDate = new Date()) {
    return tasks.map(task => {
        const bestTime = getBestInteractionTime(insights, task.persona);
        return scheduleTask(task, bestTime, baseDate);
    });
}
//# sourceMappingURL=scheduler.js.map