import { readFile, writeFile } from 'node:fs/promises';
import YAML from 'yaml';
import type { BusinessProfile } from '../core/types.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'keyword-generator' });

export type KeywordMap = Record<string, { weight: number }>;

export async function generateSearchKeywords(
  profile: BusinessProfile,
  llm: { complete(prompt: string, opts?: { temperature?: number; maxTokens?: number; responseFormat?: string }): Promise<string> },
): Promise<KeywordMap> {
  try {
    const prompt = buildPrompt(profile);
    const { completeWithCache } = await import('../adapters/llm/_cache.js');
    const raw = await completeWithCache({
      model: profile.llm.model,
      systemPrompt: `你是「${profile.business.name}」的搜索关键词生成器`,
      userPrompt: prompt,
      fetcher: async () => llm.complete(prompt, {
        temperature: 0.5,
        maxTokens: 500,
        responseFormat: 'json',
      }),
    });

    const keywords = parseKeywords(raw);
    log.info({ count: keywords.length, keywords }, 'LLM 生成搜索关键词');

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

function parseKeywords(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\[[\s\S]*?\]/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { }
    }
  }

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

export async function writebackGeneratedKeywords(
  channelsPath: string,
  generated: KeywordMap,
): Promise<{ written: number; skipped?: 'empty' | 'file_missing' | 'parse_failed' | 'write_failed' }> {
  const entries = Object.entries(generated);
  if (entries.length === 0) return { written: 0, skipped: 'empty' };

  let raw: string;
  try {
    raw = await readFile(channelsPath, 'utf-8');
  } catch {
    log.warn({ channelsPath }, 'channels.yaml 不存在，跳过关键词写回');
    return { written: 0, skipped: 'file_missing' };
  }

  let doc: ReturnType<typeof YAML.parseDocument>;
  try {
    doc = YAML.parseDocument(raw);
  } catch (e) {
    log.warn({ err: e, channelsPath }, 'channels.yaml 解析失败，跳过关键词写回');
    return { written: 0, skipped: 'parse_failed' };
  }

  let search = doc.get('search') as Record<string, unknown> | undefined;
  if (!search || typeof search !== 'object') {
    search = {};
    doc.set('search', search);
  }

  let keywords = search.keywords as Record<string, { weight: number }> | undefined;
  if (!keywords || typeof keywords !== 'object') {
    keywords = {};
  }

  for (const [kw, v] of entries) {
    keywords[kw] = v;
  }
  search.keywords = keywords;
  doc.set('search', search);

  try {
    await writeFile(channelsPath, doc.toString(), 'utf-8');
  } catch (e) {
    log.warn({ err: e, channelsPath }, 'channels.yaml 写回失败');
    return { written: 0, skipped: 'write_failed' };
  }
  log.info({ count: entries.length, channelsPath }, '关键词已写回 channels.yaml');
  return { written: entries.length };
}
