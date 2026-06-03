import type { Comment, Lead, BusinessProfile } from '../../core/types.js';
import { getLLM } from '../../adapters/registry.js';
import { loadPromptTemplates, compileIntentSystemPrompt } from './prompts-loader.js';
import { filterMarketingComments } from './marketing-filter.js';
import { analyzeBatch, type BatchContext } from './batch.js';

export interface AnalyzeCommentsOptions {
  profile: BusinessProfile;
  promptsDir: string;
  threshold?: number;
  batchSize?: number;
  llmOverride?: { complete(prompt: string, opts?: { responseFormat?: string }): Promise<string> };
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

export async function analyzeComments(
  comments: Comment[],
  opts: AnalyzeCommentsOptions,
): Promise<IntentAnalyzerResult> {
  const threshold = opts.threshold ?? 0.7;
  const batchSize = opts.batchSize ?? 10;
  const filterMarketing = opts.filterMarketing ?? true;

  let filteredComments = comments;
  let marketingFiltered = 0;
  if (filterMarketing) {
    const result = filterMarketingComments(comments);
    filteredComments = result.kept;
    marketingFiltered = result.filtered.length;
  }

  const templates = await loadPromptTemplates(opts.promptsDir);

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

  const llm = opts.llmOverride ?? getLLM(opts.profile.llm.provider);

  const batchCtx: BatchContext = {
    profile: opts.profile,
    systemPrompt,
    userTplStr,
    llm,
    threshold,
  };

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

export { loadPromptTemplates, compileIntentSystemPrompt };
export { filterMarketingComments, isMarketingAccount } from './marketing-filter.js';
export { analyzeBatch } from './batch.js';