/**
 * 搜索关键词生成器
 *
 * 从 BusinessProfile 的人设痛点 + 意图信号词，
 * 用 LLM 自动生成「目标客户在抖音评论区会怎么说」的搜索词。
 *
 * 替代 channels.yaml 里人手写的静态关键词。
 */

import type { BusinessProfile } from '../core/types.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'keyword-generator' });

/** channels.search.keywords 的格式 */
export type KeywordMap = Record<string, { weight: number }>;

/**
 * 用 LLM 从业务画像生成搜索关键词
 *
 * @returns 合并后的关键词 map（格式与 channels.yaml search.keywords 一致）
 *          失败时返回空对象（不阻塞主流程）
 */
export async function generateSearchKeywords(
  profile: BusinessProfile,
  llm: { complete(prompt: string, opts?: { temperature?: number; maxTokens?: number; responseFormat?: string }): Promise<string> },
): Promise<KeywordMap> {
  try {
    const prompt = buildPrompt(profile);
    const raw = await llm.complete(prompt, {
      temperature: 0.5,
      maxTokens: 500,
      responseFormat: 'json',
    });

    const keywords = parseKeywords(raw);
    log.info({ count: keywords.length, keywords }, 'LLM 生成搜索关键词');

    // 转成 KeywordMap 格式，权重默认 1.0
    const result: KeywordMap = {};
    for (const kw of keywords) {
      result[kw] = { weight: 1.0 };
    }
    return result;
  } catch (e) {
    log.warn({ err: e }, '关键词生成失败，跳过');
    return {};
  }
}

/**
 * 构造 prompt：把人设痛点 + 意图信号词告诉 LLM，
 * 让它生成「目标客户在抖音搜索框里会怎么搜」的关键词
 */
function buildPrompt(profile: BusinessProfile): string {
  const painPoints = profile.target_personas
    .map(p => `- ${p.name}：${p.typical_pain_points.join('；')}`)
    .join('\n');

  const signals = profile.intent_signals.join('、');

  return `你是「${profile.business.name}」的获客分析师。
业务价值主张：${profile.business.value_prop}

【目标人设及痛点】
${painPoints}

【意图信号词】${signals}

任务：生成 5-8 个抖音搜索关键词，用于找到有上述痛点的目标客户。
要求：
1. 关键词要像真人会在抖音搜索框里输入的话（口语化，不要书面语）
2. 要直接关联痛点，不要泛词（如"AI 自动化"太泛）
3. 每个关键词 2-8 个字
4. 只输出 JSON 数组，不要解释

示例输出：["剪辑太累了", "客服回复慢", "AI出题 不好用"]`;
}

/**
 * 解析 LLM 返回的关键词数组
 */
function parseKeywords(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 尝试从文本中提取 JSON 数组
    const m = raw.match(/\[[\s\S]*?\]/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
    }
  }

  // 支持 { "keywords": [...] } 包装格式
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const arrKey = Object.keys(parsed as Record<string, unknown>).find(
      k => Array.isArray((parsed as Record<string, unknown>)[k]),
    );
    if (arrKey) parsed = (parsed as Record<string, unknown>)[arrKey];
  }

  if (!Array.isArray(parsed)) return [];

  return (parsed as unknown[])
    .filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 20);
}
