/**
 * 反馈加载器（§3.11 冷启动 fallback）
 *
 * 读取 data/feedback/weekly-insights.json
 * 冷启动时返回 null，各回路 fallback 到默认值
 */
import type { WeeklyInsights } from '../../core/types.js';
/**
 * 加载最新的 weekly-insights.json
 * @returns insights 对象，冷启动期间返回 null
 */
export declare function loadLatestInsights(businessName?: string): Promise<WeeklyInsights | null>;
/**
 * 加载指定周的 insights（用于历史对比）
 */
export declare function loadInsightsForWeek(weekStart: string): Promise<WeeklyInsights | null>;
/**
 * 检查学习期是否完成（至少 2 周数据）
 */
export declare function isLearningPeriodComplete(): Promise<boolean>;
