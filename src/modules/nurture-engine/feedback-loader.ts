/**
 * 反馈加载器（§3.11 冷启动 fallback）
 *
 * 读取 data/feedback/weekly-insights.json
 * 冷启动时返回 null，各回路 fallback 到默认值
 */

import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { WeeklyInsights } from '../../core/types.js';

const FEEDBACK_DIR = 'data/feedback';
const INSIGHTS_FILE = 'weekly-insights.json';

/**
 * 加载最新的 weekly-insights.json
 * @returns insights 对象，冷启动期间返回 null
 */
export async function loadLatestInsights(businessName?: string): Promise<WeeklyInsights | null> {
  const filePath = join(FEEDBACK_DIR, INSIGHTS_FILE);

  try {
    await access(filePath);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as WeeklyInsights;
  } catch {
    // 文件不存在 → 冷启动，返回 null
    return null;
  }
}

/**
 * 加载指定周的 insights（用于历史对比）
 */
export async function loadInsightsForWeek(weekStart: string): Promise<WeeklyInsights | null> {
  const filePath = join(FEEDBACK_DIR, `weekly-insights-${weekStart}.json`);

  try {
    await access(filePath);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as WeeklyInsights;
  } catch {
    return null;
  }
}

/**
 * 检查学习期是否完成（至少 2 周数据）
 */
export async function isLearningPeriodComplete(): Promise<boolean> {
  const insights = await loadLatestInsights();
  if (!insights) return false;
  return insights.learning_period_complete ?? false;
}