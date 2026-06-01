/**
 * 意图分析器（§3.3）
 *
 * 从评论中识别「高意向潜在客户」。
 *
 * 关键设计（v1.4 业务解耦后）：
 *   - 业务相关字段全部从 `business.profile.yaml` 读
 *   - Prompt 模板从 `business/prompts/` 目录读（Handlebars 格式）
 *   - 批处理：每批 10 条评论
 */
import type { Comment, Lead, BusinessProfile } from '../../core/types.js';
import { loadPromptTemplates, compileIntentSystemPrompt, compileIntentUserPrompt } from './prompts-loader.js';
export interface AnalyzeCommentsOptions {
    /** 业务画像（来自 loadBusinessProfile） */
    profile: BusinessProfile;
    /** prompt 模板所在目录（通常为 business/prompts/） */
    promptsDir: string;
    /** intent_score 阈值（低于此不入 CRM），默认 0.7 */
    threshold?: number;
    /** 批大小，默认 10 */
    batchSize?: number;
    /** mock LLM（测试用） */
    llmOverride?: {
        complete(prompt: string, opts?: {
            responseFormat?: string;
        }): Promise<string>;
    };
    /** 是否过滤营销号，默认 true */
    filterMarketing?: boolean;
}
export interface IntentAnalyzerResult {
    leads: Lead[];
    rejected: Array<{
        cid: string;
        reason: string;
        raw?: string;
    }>;
    marketingFiltered: number;
    stats: {
        inputComments: number;
        outputLeads: number;
        rejected: number;
        llmCalls: number;
        llmErrors: number;
    };
}
/**
 * 分析一组评论，返回高意向 leads
 */
export declare function analyzeComments(comments: Comment[], opts: AnalyzeCommentsOptions): Promise<IntentAnalyzerResult>;
export { loadPromptTemplates, compileIntentSystemPrompt, compileIntentUserPrompt };
export { filterMarketingComments, isMarketingAccount } from './marketing-filter.js';
export { analyzeBatch } from './batch.js';
