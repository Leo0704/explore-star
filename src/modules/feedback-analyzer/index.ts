/**
 * 反馈分析器（§3.11）
 *
 * V1.4 实现：
 *   - runWeeklyAnalysis: 加载 events.jsonl，跑 5 条回路，写 weekly-insights.json
 *   - 5 条回路：关键词权重 / 钩子风格 / persona 价值 / 互动时段 / 触达方式
 *   - 前 2 周 learning period 数据不足时跳过调优
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  LeadEvent, LeadStatus, BusinessProfile, WeeklyInsights,
  KeywordPerformance, HookStylePerformance, PersonaValue, BestInteractionTimes,
} from '../../core/types.js';
import { computeKeywordAttribution } from './keyword-attribution.js';
import { computeHookStyleAttribution } from './hook-style-attribution.js';
import { computePersonaValue } from './persona-value.js';
import { computeInteractionTime } from './interaction-time.js';
import { recordEvent } from './event-recorder.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'feedback-analyzer' });

// ---------------------------------------------------------------------------
// 配置常量（与 spec 同步）
// ---------------------------------------------------------------------------

const LEARNING_DAYS = 14;
const LEARNING_MIN_LEADS = 30;
const LEARNING_MIN_PER_PERSONA = 5;

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export interface FeedbackAnalyzerOptions {
  eventsPath?: string;       // 默认 ./data/feedback/events.jsonl
  insightsPath?: string;    // 默认 ./data/feedback/weekly-insights.json
  channelsPath?: string;     // 默认 business/channels.yaml
  weeks?: number;            // 参考过去几周数据（默认 4）
}

export async function runWeeklyAnalysis(
  businessDir: string,
  opts: FeedbackAnalyzerOptions = {},
): Promise<WeeklyInsights> {
  const eventsPath = opts.eventsPath ?? './data/feedback/events.jsonl';
  const insightsPath = opts.insightsPath ?? './data/feedback/weekly-insights.json';

  // 1. 加载 events
  const events = await loadEvents(eventsPath);

  // 2. 学习期检查
  const stats = computeStats(events);
  const learningComplete = isLearningPeriodComplete(stats);

  // 3. 计算各维度（无论学习期是否完成都计算，用于展示）
  const keywordPerf = learningComplete ? computeKeywordAttribution(events).performance : [];
  const hookStylePerf = computeHookStyleAttribution(events).performance;
  const personaVal = computePersonaValue(events).values;
  const bestTimes = computeInteractionTime(events).times;

  // 4. 构建 insights
  const insights: WeeklyInsights = {
    week_start: getWeekStart(),
    learning_period_complete: learningComplete,
    keyword_performance: keywordPerf,
    hook_style_performance: hookStylePerf,
    persona_value: personaVal,
    best_interaction_times: bestTimes,
    generated_at: new Date().toISOString(),
  };

  // 5. 写 insights
  await mkdir(dirname(insightsPath), { recursive: true });
  await writeFile(insightsPath, JSON.stringify(insights, null, 2), 'utf-8');

  // 6. 回路 1：自动写回 channels.yaml 关键词权重（学习期完成后 + auto_apply 的）
  if (learningComplete && keywordPerf.length > 0) {
    await applyKeywordWeights(keywordPerf, opts.channelsPath);
  }

  return insights;
}

/**
 * 分析单维度（供 CLI 调用）
 */
export async function analyzeKeywordPerformance(opts: FeedbackAnalyzerOptions = {}): Promise<KeywordPerformance[]> {
  const events = await loadEvents(opts.eventsPath ?? './data/feedback/events.jsonl');
  return computeKeywordAttribution(events).performance;
}

// ---------------------------------------------------------------------------
// §1 学习期检查
// ---------------------------------------------------------------------------

function isLearningPeriodComplete(stats: ReturnType<typeof computeStats>): boolean {
  return stats.daysSinceStart >= LEARNING_DAYS
    && stats.totalLeads >= LEARNING_MIN_LEADS
    && Object.values(stats.leadsByPersona).every(n => n >= LEARNING_MIN_PER_PERSONA);
}

interface SystemStats {
  daysSinceStart: number;
  totalLeads: number;
  leadsByPersona: Record<string, number>;
  leadsByStatus: Record<LeadStatus, number>;
}

function computeStats(events: LeadEvent[]): SystemStats {
  const leadsByPersona: Record<string, number> = {};
  const leadsByStatus: Record<string, number> = {};
  let earliest = Date.now();

  const uniqueCids = new Set<string>();
  for (const e of events) {
    uniqueCids.add(e.cid);
    leadsByPersona[e.persona] = (leadsByPersona[e.persona] ?? 0) + 1;
    if (e.to_status) leadsByStatus[e.to_status] = (leadsByStatus[e.to_status] ?? 0) + 1;
    const t = new Date(e.interaction_time).getTime();
    if (t < earliest) earliest = t;
  }

  return {
    daysSinceStart: Math.floor((Date.now() - earliest) / (1000 * 60 * 60 * 24)),
    totalLeads: uniqueCids.size,
    leadsByPersona,
    leadsByStatus: leadsByStatus as Record<LeadStatus, number>,
  };
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

async function loadEvents(path: string): Promise<LeadEvent[]> {
  try {
    const raw = await readFile(path, 'utf-8');
    const out: LeadEvent[] = [];
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        out.push(JSON.parse(line) as LeadEvent);
      } catch (err) {
        log.warn({ err, line }, 'events.jsonl 跳过无法解析的行');
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 回路 1：写回 channels.yaml 关键词权重
// ---------------------------------------------------------------------------

async function applyKeywordWeights(
  performance: KeywordPerformance[],
  channelsPath?: string,
): Promise<void> {
  const path = channelsPath ?? './business/channels.yaml';
  try {
    const yaml = await import('yaml');
    const raw = await readFile(path, 'utf-8');
    // 用 parseDocument 保留注释（yaml.parse + yaml.stringify 会丢注释）
    const doc = yaml.parseDocument(raw);
    const config = doc.toJSON() as {
      search?: {
        keywords?: Record<string, { weight?: number }>;
        weight_min?: number;
        weight_max?: number;
        weight_cooldown_weeks?: number;
        weight_meta?: Record<string, { last_adjusted_week?: string; consecutive_direction?: number }>;
      };
    } | null;

    if (!config?.search?.keywords) return;

    const wMin = config.search.weight_min ?? 0.2;
    const wMax = config.search.weight_max ?? 3.0;
    const cooldownWeeks = config.search.weight_cooldown_weeks ?? 3;

    // weight_meta 记录每个关键词的调整历史（写在 channels.yaml 里）
    if (!config.search.weight_meta) config.search.weight_meta = {};
    const meta = config.search.weight_meta;

    const currentWeek = getWeekStart();
    let changed = false;

    for (const kw of performance) {
      if (!kw.auto_apply || kw.suggested_weight == null) continue;
      const current = config.search.keywords[kw.keyword]?.weight;
      if (current == null) continue;

      const clamped = Math.max(wMin, Math.min(wMax, kw.suggested_weight));
      if (Math.abs(current - clamped) < 0.01) continue;

      // 冷却期检查：连续 N 周同方向调整后暂停 1 周
      const direction = clamped > current ? 1 : -1;
      const kwMeta = meta[kw.keyword] ?? {};
      const lastDir = kwMeta.consecutive_direction ?? 0;
      const sameDirection = (lastDir > 0 && direction > 0) || (lastDir < 0 && direction < 0);
      const consecutiveWeeks = sameDirection ? Math.abs(lastDir) : 0;

      if (consecutiveWeeks >= cooldownWeeks) {
        // 冷却中：跳过本周，重置计数
        meta[kw.keyword] = { last_adjusted_week: currentWeek, consecutive_direction: 0 };
        continue;
      }

      // 应用调整
      config.search.keywords[kw.keyword].weight = Math.round(clamped * 100) / 100;
      meta[kw.keyword] = {
        last_adjusted_week: currentWeek,
        consecutive_direction: sameDirection ? consecutiveWeeks + 1 : direction,
      };
      changed = true;
    }

    if (changed) {
      // 把内存中已修改的 config 写回 doc，再用 doc.toString() 输出，保留注释
      doc.set('search', config.search);
      await writeFile(path, doc.toString(), 'utf-8');
      log.info('回路 1：已更新 channels.yaml 关键词权重');
    }
  } catch {
    // channels.yaml 不存在或不可写，静默跳过
  }
}

function getWeekStart(): string {
  const d = new Date();
  const day = d.getUTCDay(); // 0=周日
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// recordEvent 导出（供其他模块调用）
// ---------------------------------------------------------------------------

export { recordEvent } from './event-recorder.js';

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

export async function runCLI(args: string[]): Promise<void> {
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const businessDir = get('--business');
  if (!businessDir) {
    console.error('错误：feedback-analyzer 需要 --business <dir>');
    process.exit(1);
  }

  const insights = await runWeeklyAnalysis(businessDir);

  log.info({
    week_start: insights.week_start,
    learning_period_complete: insights.learning_period_complete,
    keyword_count: insights.keyword_performance.length,
    hook_style_count: insights.hook_style_performance.length,
    persona_count: insights.persona_value.length,
    best_time_count: insights.best_interaction_times.length,
  }, '已生成周报');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}