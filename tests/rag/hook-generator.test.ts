import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateHook } from '../../src/rag/hook-generator.js';
import { retrieveTopK, clearCache } from '../../src/rag/retriever.js';
import type { BusinessProfile, Lead, EmbeddingProvider } from '../../src/core/types.js';
import { _clearMemoryCache } from '../../src/adapters/llm/_cache.js';

const mockProfile: BusinessProfile = {
  business: {
    name: '燃点 FDE',
    value_prop: '派工程师到企业现场做定制化 AI 落地',
  },
  target_personas: [
    {
      id: 'self_media',
      name: '自媒体矩阵',
      description: '做多账号内容生产',
      typical_pain_points: ['AI 剪辑省人工'],
    },
  ],
  intent_signals: ['AI 工具'],
  llm: { provider: 'deepseek', model: 'deepseek-v3', api_key_env: 'DEEPSEEK_API_KEY' },
  crm: { type: 'feishu', config: {} },
  hook_config: { style: '像朋友推荐，不像销售', max_length: 30, language: '中文' },
};

function makeLead(overrides: Partial<Lead> = {}): Lead {
  const now = new Date().toISOString();
  return {
    cid: 'cid_test',
    source: 'douyin_user_videos',
    aweme_id: 'aweme_123',
    video_url: 'https://douyin.com/video/123',
    video_desc: 'AI 工具推荐视频',
    keyword: 'AI 工具',
    nickname: '测试用户',
    user_signature: '普通用户',
    follower_count: 5000,
    user_uid: 'uid_123',
    comment_text: '这个 AI 工具真的好用',
    comment_digg_count: 50,
    comment_create_time: now,
    is_target_persona: true,
    persona: 'self_media',
    pain_point: 'AI 剪辑省人工',
    intent_score: 0.85,
    buying_stage: 'consideration',
    suggested_reply_hook: '赞',
    suggested_dm_hook: 'hi',
    status: '新发现',
    status_history: [{ from: null, to: '新发现', at: now }],
    execution_count: 0,
    response_count: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

const mockEmbeddingProvider: EmbeddingProvider = {
  dimensions: 1536,
  model: 'text-embedding-3-small',
  embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
  embedBatch: vi.fn().mockResolvedValue([new Array(1536).fill(0.1)]),
};

describe('generateHook 钩子生成', () => {
  const opts = {
    profile: mockProfile,
    promptsDir: './business.example/燃点-FDE/prompts',
    knowledgeDir: './business.example/燃点-FDE/knowledge',
    dbPath: './data/vectors.db',
    embeddingProvider: mockEmbeddingProvider,
    topK: 3,
  };

  afterEach(() => {
    vi.restoreAllMocks();
    _clearMemoryCache();
  });

  it('生成 reply 类型钩子', async () => {
    const lead = makeLead();
    const mockLLM = vi.fn().mockResolvedValue('这条 AI 工具确实帮我们省了不少剪辑人工');

    const oldGetLLM = await import('../../src/adapters/registry.js').then(m => m.getLLM);
    vi.spyOn(await import('../../src/adapters/registry.js'), 'getLLM').mockReturnValue({
      complete: mockLLM,
    } as any);

    const result = await generateHook(mockProfile, lead, 'reply', opts);
    expect(result.hook).toBeTruthy();
    expect(result.hookStyle).toBeTruthy();
  });

  it('生成 dm 类型钩子', async () => {
    const lead = makeLead();
    const mockLLM = vi.fn().mockResolvedValue('看了你这条评论，想起我们给杭州某 MCN 做了 AI 剪辑定制');

    vi.spyOn(await import('../../src/adapters/registry.js'), 'getLLM').mockReturnValue({
      complete: mockLLM,
    } as any);

    const result = await generateHook(mockProfile, lead, 'dm', opts);
    expect(result.hook).toBeTruthy();
  });

  it('写回 lead.hook_style', async () => {
    const lead = makeLead();
    const mockLLM = vi.fn().mockResolvedValue('钩子话术');

    vi.spyOn(await import('../../src/adapters/registry.js'), 'getLLM').mockReturnValue({
      complete: mockLLM,
    } as any);

    const result = await generateHook(mockProfile, lead, 'reply', opts);
    expect(result.lead.hook_style).toBeTruthy();
    expect((lead as any).hook_style).toBeUndefined();
  });

});

describe('retrieveTopK 检索', () => {
  it('db 目录不存在时返回空数组', async () => {
    const docs = await retrieveTopK(
      'AI 剪辑',
      3,
      './non-existent-dir/vectors.db',
      mockEmbeddingProvider,
    );
    expect(docs).toEqual([]);
  });
});

describe('cosine similarity', () => {
  it('相似度计算正确', async () => {
    const { cosineSimilarity } = await import('../../src/rag/index-builder.js');

    const a = [0.1, 0.2, 0.3];
    const b = [0.1, 0.2, 0.3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);

    const c = [1, 0, 0];
    const d = [0, 1, 0];
    expect(cosineSimilarity(c, d)).toBeCloseTo(0.0);

    const e = [1, 0, 0];
    const f = [-1, 0, 0];
    expect(cosineSimilarity(e, f)).toBeCloseTo(-1.0);
  });
});