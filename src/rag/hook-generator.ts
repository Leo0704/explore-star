import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BusinessProfile, Lead, EmbeddingProvider } from '../core/types.js';
import { getLLM } from '../adapters/registry.js';
import { completeWithCache } from '../adapters/llm/_cache.js';
import { compileHookPrompt } from '../modules/intent-analyzer/prompts-loader.js';
import { selectBestHookStyle } from '../modules/nurture-engine/feedback-loader.js';
import { retrieveTopK, type RetrievedDoc } from './retriever.js';

export interface HookGeneratorOptions {
  profile: BusinessProfile;
  promptsDir: string;
  knowledgeDir: string;
  dbPath: string;
  embeddingProvider: EmbeddingProvider;
  topK?: number;
}

export interface GenerateHookResult {
  hook: string;
  hookStyle: string;
  usedDocs: RetrievedDoc[];
  lead: Lead;
}

export async function generateHook(
  profile: BusinessProfile,
  lead: Lead,
  hookType: 'reply' | 'dm',
  opts: HookGeneratorOptions,
): Promise<GenerateHookResult> {
  const topK = opts.topK ?? 3;

  const bestStyle = await selectBestHookStyle();
  const hookStyle = bestStyle ?? profile.hook_config?.style ?? '像朋友推荐，不像销售';

  const query = `${lead.persona} ${lead.pain_point}`;
  let usedDocs: RetrievedDoc[] = [];
  try {
    usedDocs = await retrieveTopK(query, topK, opts.dbPath, opts.embeddingProvider);
  } catch {
    usedDocs = [];
  }

  const tplFile = hookType === 'reply' ? 'hook-reply.md' : 'hook-dm.md';
  const tplPath = join(opts.promptsDir, tplFile);
  let tpl: string;
  try {
    tpl = await readFile(tplPath, 'utf-8');
  } catch {
    tpl = getInlineTemplate(hookType);
  }

  const knowledgeText = usedDocs.length > 0
    ? usedDocs.map(d => `> ${d.path}\n${d.content}`).join('\n\n')
    : '（无相关知识库内容）';

  const hookConfig = {
    max_length: profile.hook_config?.max_length ?? 30,
    style: hookStyle,
    language: profile.hook_config?.language ?? '中文',
  };

  const prompt = compileHookPrompt(tpl, {
    business: { name: profile.business.name },
    lead: JSON.stringify(lead, null, 2),
    knowledge_docs: knowledgeText,
    hook_config: hookConfig,
  });

  const llm = getLLM(profile.llm.provider);
  const maxLength = (profile.hook_config?.max_length ?? 30) * 2;
  const systemMarker = '你是';
  const systemPrompt = prompt.startsWith(systemMarker)
    ? prompt.split('\n\n')[0]
    : `你是「${profile.business.name}」的获客写手`;
  const userPrompt = prompt.startsWith(systemMarker) ? prompt.split('\n\n').slice(1).join('\n\n') : prompt;
  const output = await completeWithCache({
    model: profile.llm.model,
    systemPrompt,
    userPrompt,
    fetcher: async () => llm.complete(prompt, { temperature: 0.7, maxTokens: 200 }),
  });
  const hook = Array.from(output.trim()).slice(0, maxLength).join('');

  const updatedLead: Lead = { ...lead, hook_style: hookStyle };

  return { hook, hookStyle, usedDocs, lead: updatedLead };
}

function getInlineTemplate(hookType: 'reply' | 'dm'): string {
  const typeLabel = hookType === 'reply' ? '评论回复' : '私信开头';
  return `你是「{{business.name}}」的获客写手，**写一条${typeLabel}**来自然地接住这条评论。

## 客户画像
{{lead}}

## 知识库
{{knowledge_docs}}

## 要求
1. 不超过 {{hook_config.max_length}} 字
2. 必须引用一个具体案例/数字/方法
3. 结尾有钩子
4. 风格：{{hook_config.style}}
5. 输出语言：{{hook_config.language}}

只输出话术本身，不要加任何解释。`;
}