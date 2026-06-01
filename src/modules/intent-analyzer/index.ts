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
import { getLLM } from '../../adapters/registry.js';
import { loadPromptTemplates, compileIntentSystemPrompt, compileIntentUserPrompt } from './prompts-loader.js';
import { filterMarketingComments } from './marketing-filter.js';
import { analyzeBatch, type BatchContext } from './batch.js';

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

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
  llmOverride?: { complete(prompt: string, opts?: { responseFormat?: string }): Promise<string> };
  /** 是否过滤营销号，默认 true */
  filterMarketing?: boolean;
}

export interface IntentAnalyzerResult {
  leads: Lead[];
  rejected: Array<{ cid: string; reason: string; raw?: string }>;
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
export async function analyzeComments(
  comments: Comment[],
  opts: AnalyzeCommentsOptions,
): Promise<IntentAnalyzerResult> {
  const threshold = opts.threshold ?? 0.7;
  const batchSize = opts.batchSize ?? 10;
  const filterMarketing = opts.filterMarketing ?? true;

  // 1. 过滤营销号
  let filteredComments = comments;
  let marketingFiltered = 0;
  if (filterMarketing) {
    const result = filterMarketingComments(comments);
    filteredComments = result.kept;
    marketingFiltered = result.filtered.length;
  }

  // 2. 加载 prompt 模板
  const templates = await loadPromptTemplates(opts.promptsDir);

  // 注入业务画像（模板变量 {{ business.name }} 等）
  const systemCtx = {
    business: {
      name: opts.profile.business.name,
      value_prop: opts.profile.business.value_prop,
      target_personas: opts.profile.target_personas,
      intent_signals: opts.profile.intent_signals,
      buying_stages: opts.profile.buying_stages,
    },
  };
  const systemPrompt = compileIntentSystemPrompt(templates.intentSystem, systemCtx);
  const userTplStr = templates.intentUser;

  // 3. LLM
  const llm = opts.llmOverride ?? getLLM(opts.profile.llm.provider);

  const batchCtx: BatchContext = {
    profile: opts.profile,
    systemPrompt,
    userTplStr,
    llm,
    threshold,
  };

  // 4. 分批处理
  const allLeads: Lead[] = [];
  const allRejected: IntentAnalyzerResult['rejected'] = [];
  let llmCalls = 0;
  let llmErrors = 0;

  for (let i = 0; i < filteredComments.length; i += batchSize) {
    const batch = filteredComments.slice(i, i + batchSize);
    const { leads, rejected, llmErrors: errors } = await analyzeBatch(batch, batchCtx);
    allLeads.push(...leads);
    allRejected.push(...rejected);
    llmCalls++;
    llmErrors += errors;
  }

  return {
    leads: allLeads,
    rejected: allRejected,
    marketingFiltered,
    stats: {
      inputComments: comments.length,
      outputLeads: allLeads.length,
      rejected: allRejected.length,
      llmCalls,
      llmErrors,
    },
  };
}

// re-export 工具（方便编排器直接用）
export { loadPromptTemplates, compileIntentSystemPrompt, compileIntentUserPrompt };
export { filterMarketingComments, isMarketingAccount } from './marketing-filter.js';
export { analyzeBatch } from './batch.js';