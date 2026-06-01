/**
 * RAG 钩子生成器
 *
 * 业务方钩子生成：知识库检索 + 反馈驱动风格选择 + lead.hook_style 写入
 *
 * 关键设计（§3.4）：
 *   - 先尝试读取 data/feedback/weekly-insights.json，取最优 hook_style
 *   - 冷启动 fallback: profile.hook_config.style ?? '像朋友推荐，不像销售'
 *   - 必须写回 lead.hook_style
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BusinessProfile, Lead, EmbeddingProvider } from '../core/types.js';
import { getLLM } from '../adapters/registry.js';
import { compileHookPrompt } from '../modules/intent-analyzer/prompts-loader.js';
import { retrieveTopK, type RetrievedDoc } from './retriever.js';

const INSIGHTS_PATH = './data/feedback/weekly-insights.json';

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
}

/**
 * 读取最新的 weekly-insights.json（反馈驱动风格选择）
 */
async function loadLatestInsights(): Promise<{
  hook_style_performance: Array<{ style: string; replied: number; tested: number; rate: number }>;
} | null> {
  try {
    const raw = await readFile(INSIGHTS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 从 insights 中取回复率最高的风格
 */
function selectBestStyle(
  insights: { hook_style_performance: Array<{ style: string; replied: number; tested: number; rate: number }> } | null,
  defaultStyle: string,
): string {
  if (!insights?.hook_style_performance?.length) {
    return defaultStyle;
  }

  const best = insights.hook_style_performance
    .filter(s => s.tested >= 3) // 至少 3 次测试才采纳
    .sort((a, b) => b.rate - a.rate)[0];

  return best?.style ?? defaultStyle;
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

  // 1. 读取 weekly insights，取最优风格
  const insights = await loadLatestInsights();
  const defaultStyle = profile.hook_config?.style ?? '像朋友推荐，不像销售';
  const hookStyle = selectBestStyle(insights, defaultStyle);

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

  // 5. 调用 LLM
  const llm = getLLM(profile.llm.provider);
  const maxLength = (profile.hook_config?.max_length ?? 30) * 2; // 2 倍截断
  const output = await llm.complete(prompt, { temperature: 0.7, maxTokens: 200 });
  const hook = output.trim().slice(0, maxLength);

  // 6. 写回 lead.hook_style（核心：反馈归因需要知道本次使用的风格）
  // 注意：这是内存操作，调用方负责写回 CRM
  (lead as Lead & { hook_style?: string }).hook_style = hookStyle;

  return { hook, hookStyle, usedDocs };
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