import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { WeeklyInsights } from '../../core/types.js';

const FEEDBACK_DIR = 'data/feedback';
const INSIGHTS_FILE = 'weekly-insights.json';

export async function loadLatestInsights(businessName?: string): Promise<WeeklyInsights | null> {
  const filePath = join(FEEDBACK_DIR, INSIGHTS_FILE);

  try {
    await access(filePath);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as WeeklyInsights;
  } catch {
    return null;
  }
}

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

export async function isLearningPeriodComplete(): Promise<boolean> {
  const insights = await loadLatestInsights();
  if (!insights) return false;
  return insights.learning_period_complete ?? false;
}

export async function selectBestHookStyle(): Promise<string | null> {
  const insights = await loadLatestInsights();
  if (!insights?.hook_style_performance?.length) return null;

  const candidates = insights.hook_style_performance
    .filter(s => s.tested >= 3)
    .sort((a, b) => b.rate - a.rate);

  return candidates[0]?.style ?? null;
}