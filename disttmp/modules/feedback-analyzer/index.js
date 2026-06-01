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
import { computeKeywordAttribution } from './keyword-attribution.js';
import { computeHookStyleAttribution } from './hook-style-attribution.js';
import { computePersonaValue } from './persona-value.js';
import { computeInteractionTime } from './interaction-time.js';
// ---------------------------------------------------------------------------
// 配置常量（与 spec 同步）
// ---------------------------------------------------------------------------
const LEARNING_DAYS = 14;
const LEARNING_MIN_LEADS = 30;
const LEARNING_MIN_PER_PERSONA = 5;
export async function runWeeklyAnalysis(businessDir, opts = {}) {
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
    const insights = {
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
    return insights;
}
/**
 * 分析单维度（供 CLI 调用）
 */
export async function analyzeKeywordPerformance(opts = {}) {
    const events = await loadEvents(opts.eventsPath ?? './data/feedback/events.jsonl');
    return computeKeywordAttribution(events).performance;
}
// ---------------------------------------------------------------------------
// §1 学习期检查
// ---------------------------------------------------------------------------
function isLearningPeriodComplete(stats) {
    return stats.daysSinceStart >= LEARNING_DAYS
        && stats.totalLeads >= LEARNING_MIN_LEADS
        && Object.values(stats.leadsByPersona).every(n => n >= LEARNING_MIN_PER_PERSONA);
}
function computeStats(events) {
    const leadsByPersona = {};
    const leadsByStatus = {};
    let earliest = Date.now();
    const uniqueCids = new Set();
    for (const e of events) {
        uniqueCids.add(e.cid);
        leadsByPersona[e.persona] = (leadsByPersona[e.persona] ?? 0) + 1;
        if (e.to_status)
            leadsByStatus[e.to_status] = (leadsByStatus[e.to_status] ?? 0) + 1;
        const t = new Date(e.interaction_time).getTime();
        if (t < earliest)
            earliest = t;
    }
    return {
        daysSinceStart: Math.floor((Date.now() - earliest) / (1000 * 60 * 60 * 24)),
        totalLeads: uniqueCids.size,
        leadsByPersona,
        leadsByStatus: leadsByStatus,
    };
}
// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
async function loadEvents(path) {
    try {
        const raw = await readFile(path, 'utf-8');
        return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    }
    catch {
        return [];
    }
}
function getWeekStart() {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay()); // 周日
    return d.toISOString().slice(0, 10);
}
// ---------------------------------------------------------------------------
// recordEvent 导出（供其他模块调用）
// ---------------------------------------------------------------------------
export { recordEvent } from './event-recorder.js';
// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------
export async function runCLI(args) {
    const get = (flag) => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const businessDir = get('--business') || './business.example/燃点-FDE';
    const insights = await runWeeklyAnalysis(businessDir);
    console.log(`[feedback-analyzer] 已生成 ${insights.week_start} 周报`);
    console.log(`  学习期完成：${insights.learning_period_complete}`);
    console.log(`  关键词：${insights.keyword_performance.length} 个`);
    console.log(`  钩子风格：${insights.hook_style_performance.length} 个`);
    console.log(`  Persona：${insights.persona_value.length} 个`);
    console.log(`  最佳时段：${insights.best_interaction_times.length} 个 persona`);
}
if (import.meta.url === `file://${process.argv[1]}`) {
    runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
//# sourceMappingURL=index.js.map