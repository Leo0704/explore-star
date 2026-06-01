/**
 * 反馈分析器（§3.11）
 *
 * V1.4 实现：
 *   - runWeeklyAnalysis: 加载 events.jsonl，跑 5 条回路，写 weekly-insights.json
 *   - 5 条回路：关键词权重 / 钩子风格 / persona 价值 / 互动时段 / 触达方式
 *   - 前 2 周 learning period 数据不足时跳过调优
 */
import type { WeeklyInsights, KeywordPerformance } from '../../core/types.js';
export interface FeedbackAnalyzerOptions {
    eventsPath?: string;
    insightsPath?: string;
    channelsPath?: string;
}
export declare function runWeeklyAnalysis(businessDir: string, opts?: FeedbackAnalyzerOptions): Promise<WeeklyInsights>;
/**
 * 分析单维度（供 CLI 调用）
 */
export declare function analyzeKeywordPerformance(opts?: FeedbackAnalyzerOptions): Promise<KeywordPerformance[]>;
export { recordEvent } from './event-recorder.js';
export declare function runCLI(args: string[]): Promise<void>;
