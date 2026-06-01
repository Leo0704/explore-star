/**
 * 调度器（§3.6.1 + §3.11 回路 3/4）
 *
 * 按 persona 价值排序 + 最佳时段排程
 */
import type { Lead, Task, BusinessProfile, WeeklyInsights } from '../../core/types.js';
export interface BestTimeSlot {
    weekday: number;
    hour: number;
    minute: number;
}
/**
 * 从 weekly-insights.json 读取 persona 的最佳时段
 * 冷启动时返回默认时段
 */
export declare function getBestInteractionTime(insights: WeeklyInsights | null, personaId: string): BestTimeSlot;
/**
 * 计算任务 scheduled_at（最佳时段）
 */
export declare function scheduleTask(task: Task, bestTime: BestTimeSlot, baseDate?: Date): Task;
/**
 * 获取 persona 价值分
 */
export declare function getPersonaValue(profile: BusinessProfile, insights: WeeklyInsights | null, personaId: string): number;
/**
 * 按 persona 价值降序排序 leads
 */
export declare function sortByPersonaValue(leads: Lead[], profile: BusinessProfile, insights: WeeklyInsights | null): Lead[];
export declare function scheduleDailyTasks(tasks: Task[], profile: BusinessProfile, insights: WeeklyInsights | null, baseDate?: Date): Task[];
