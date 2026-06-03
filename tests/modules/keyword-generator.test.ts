import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BusinessProfile, LLMProvider } from '../../src/core/types.js';
import { _clearMemoryCache } from '../../src/adapters/llm/_cache.js';

beforeEach(() => {
  _clearMemoryCache();
});

function makeProfile(): BusinessProfile {
  return {
    business: { name: '测试业务', value_prop: '测试价值主张' },
    target_personas: [
      {
        id: 'test_persona',
        name: '测试人设',
        typical_pain_points: ['痛点A', '痛点B'],
      },
    ],
    intent_signals: ['信号1', '信号2'],
    llm: { provider: 'custom', model: 'test', api_key_env: 'TEST' },
    crm: { type: 'csv', config: {} },
  };
}

function makeLLM(response: string): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue(response),
    embed: vi.fn().mockResolvedValue([]),
    capabilities: { jsonMode: true, functionCalling: false, vision: false, contextWindow: 4096 },
    pricing: { inputPerMTok: 0, outputPerMTok: 0, embedPerMTok: 0 },
    ping: vi.fn().mockResolvedValue({ ok: true, latency_ms: 10 }),
  };
}

describe('generateSearchKeywords', () => {
  it('LLM 返回合法 JSON 数组 → 返回 KeywordMap', async () => {
    const { generateSearchKeywords } = await import('../../src/modules/keyword-generator.js');
    const llm = makeLLM('["剪辑太累了", "客服回复慢", "AI出题不好用"]');

    const result = await generateSearchKeywords(makeProfile(), llm);

    expect(Object.keys(result)).toEqual(['剪辑太累了', '客服回复慢', 'AI出题不好用']);
    for (const v of Object.values(result)) {
      expect(v.weight).toBe(1.0);
    }
  });

  it('LLM 返回空数组 → 返回空对象', async () => {
    const { generateSearchKeywords } = await import('../../src/modules/keyword-generator.js');
    const llm = makeLLM('[]');

    const result = await generateSearchKeywords(makeProfile(), llm);

    expect(result).toEqual({});
  });

  it('LLM 返回非法 JSON → 返回空对象（不抛错）', async () => {
    const { generateSearchKeywords } = await import('../../src/modules/keyword-generator.js');
    const llm = makeLLM('这不是JSON');

    const result = await generateSearchKeywords(makeProfile(), llm);

    expect(result).toEqual({});
  });

  it('LLM 抛异常 → 返回空对象（不阻塞主流程）', async () => {
    const { generateSearchKeywords } = await import('../../src/modules/keyword-generator.js');
    const llm = makeLLM('');
    (llm.complete as any).mockRejectedValue(new Error('API 超时'));

    const result = await generateSearchKeywords(makeProfile(), llm);

    expect(result).toEqual({});
  });

  it('LLM 返回超长关键词（>20字）→ 被过滤掉', async () => {
    const { generateSearchKeywords } = await import('../../src/modules/keyword-generator.js');
    const long = '这是一个超级超级超级超级超级超级超级长的关键词';
    const llm = makeLLM(`["短词", "${long}"]`);

    const result = await generateSearchKeywords(makeProfile(), llm);

    expect(Object.keys(result)).toEqual(['短词']);
  });

  it('LLM 返回包装对象 { keywords: [...] } → 正确解析', async () => {
    const { generateSearchKeywords } = await import('../../src/modules/keyword-generator.js');
    const llm = makeLLM('{"keywords": ["词1", "词2"]}');

    const result = await generateSearchKeywords(makeProfile(), llm);

    expect(Object.keys(result)).toEqual(['词1', '词2']);
  });

  it('prompt 包含业务名和人设痛点', async () => {
    const { generateSearchKeywords } = await import('../../src/modules/keyword-generator.js');
    const llm = makeLLM('["测试"]');

    await generateSearchKeywords(makeProfile(), llm);

    const prompt = (llm.complete as any).mock.calls[0][0] as string;
    expect(prompt).toContain('测试业务');
    expect(prompt).toContain('测试价值主张');
    expect(prompt).toContain('测试人设');
    expect(prompt).toContain('痛点A');
    expect(prompt).toContain('信号1');
  });
});
