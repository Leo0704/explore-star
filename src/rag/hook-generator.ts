/**
 * RAG 钩子生成器
 *
 * 业务方钩子生成：知识库检索 + 反馈驱动风格选择 + lead.hook_style 写入
 *
 * 关键设计（§3.4）：
 *   - 先尝试读取 data/feedback/weekly-insights.json，取最优 hook_style
 *   - 冷启动 fallback: profile.hook_config.style ?? '像朋友推荐，不像销售'
 *   - 必须写回 lead.hook_style
 *
 * Bug 32 修复：风格选择统一用 feedback-loader.selectBestHookStyle
 *   （之前 hook-generator 内部有 selectBestStyle + 局部 loadLatestInsights，与
 *    feedback-loader.selectBestHookStyle 重复且行为不一致 —— 后者返回 null 让
 *    caller 决定 fallback，前者直接吃 defaultStyle）。两处共用同一函数。
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BusinessProfile, Lead, EmbeddingProvider } from '../core/types.js';
import { getLLM } from '../adapters/registry.js';
// P0-G 修复：hook-generator 也接 completeWithCache，重复 lead 不重复扣费
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
  /** 返回的 lead 已带 hook_style 字段；调用方负责写回 CRM（不再就地改 input） */
  lead: Lead;
}

/**
 * 生成钩子话术
 *
 * @param profile      业务画像
 * @param lead         目标 lead
 * @param hookType     'reply'（评论回复）或 'dm'（私信）
 * @param opts         生成选项
 */
export async function generateHook(
  profile: BusinessProfile,
  lead: Lead,
  hookType: 'reply' | 'dm',
  opts: HookGeneratorOptions,
): Promise<GenerateHookResult> {
  const topK = opts.topK ?? 3;

  // 1. 取最优风格（统一走 feedback-loader.selectBestHookStyle）
  //    优先级：weekly-insights.json（≥3 次测试的最优风格） > profile.hook_config.style > 默认
  const bestStyle = await selectBestHookStyle();
  const hookStyle = bestStyle ?? profile.hook_config?.style ?? '像朋友推荐，不像销售';

  // 2. 知识库检索 top-K
  const query = `${lead.persona} ${lead.pain_point}`;
  let usedDocs: RetrievedDoc[] = [];
  try {
    usedDocs = await retrieveTopK(query, topK, opts.dbPath, opts.embeddingProvider);
  } catch {
    // 检索失败不影响生成（降级到无知识库）
    usedDocs = [];
  }

  // 3. 加载 prompt 模板
  const tplFile = hookType === 'reply' ? 'hook-reply.md' : 'hook-dm.md';
  const tplPath = join(opts.promptsDir, tplFile);
  let tpl: string;
  try {
    tpl = await readFile(tplPath, 'utf-8');
  } catch {
    // 模板不存在时用内联 fallback
    tpl = getInlineTemplate(hookType);
  }

  // 4. 拼装 prompt
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

  // 5. 调用 LLM（带 cache —— 同一 lead 多次跑 hook-generator 不重复扣费）
  const llm = getLLM(profile.llm.provider);
  const maxLength = (profile.hook_config?.max_length ?? 30) * 2; // 2 倍截断
  // P0-G：把单字符串 prompt 拆为 system（业务身份/风格）+ user（lead + 知识库）
  // 简单实现：前 1 段作为 system，其余作为 user。模板里有 "你是「{{business.name}}」" 这种开局。
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
  // Bug 62: 按 codepoint 截断,避免 .slice 在 UTF-8 代理对/组合字符中间切断
  const hook = Array.from(output.trim()).slice(0, maxLength).join('');

  // 6. 返回带 hook_style 的 lead（不修改入参），调用方负责 crm.updateLeadFields 持久化
  const updatedLead: Lead = { ...lead, hook_style: hookStyle };

  return { hook, hookStyle, usedDocs, lead: updatedLead };
}

// ---------------------------------------------------------------------------
// 内联 fallback 模板（模板文件缺失时使用）
// ---------------------------------------------------------------------------

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