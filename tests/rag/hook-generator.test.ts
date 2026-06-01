/**
 * RAG 钩子生成器测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateHook } from '../../src/rag/hook-generator.js';
import { retrieveTopK, clearCache } from '../../src/rag/retriever.js';
import type { BusinessProfile, Lead, EmbeddingProvider } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// mock profile
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// mock lead
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// mock embedding provider
// ---------------------------------------------------------------------------

const mockEmbeddingProvider: EmbeddingProvider = {
  dimensions: 1536,
  model: 'text-embedding-3-small',
  embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
  embedBatch: vi.fn().mockResolvedValue([new Array(1536).fill(0.1)]),
};

// ---------------------------------------------------------------------------
// 测试：generateHook
// ---------------------------------------------------------------------------

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

  it('冷启动时使用 profile.hook_config.style 作为默认风格', async () => {
    const lead = makeLead();
    const mockLLM = vi.fn().mockResolvedValue('钩子话术');

    vi.spyOn(await import('../../src/adapters/registry.js'), 'getLLM').mockReturnValue({
      complete: mockLLM,
    } as any);

    const result = await generateHook(mockProfile, lead, 'reply', opts);
    // 无 weekly-insights.json 时，使用 profile 的 style
    expect(result.hookStyle).toBe('像朋友推荐，不像销售');
  });

  it('写回 lead.hook_style', async () => {
    const lead = makeLead();
    const mockLLM = vi.fn().mockResolvedValue('钩子话术');

    vi.spyOn(await import('../../src/adapters/registry.js'), 'getLLM').mockReturnValue({
      complete: mockLLM,
    } as any);

    await generateHook(mockProfile, lead, 'reply', opts);
    expect((lead as any).hook_style).toBeTruthy();
  });

  it('weekly-insights.json 存在时使用最优风格（tested >= 3 + 最高 rate）', async () => {
    // 重置模块 + doMock 让 mock 仅对本次 generateHook 导入生效
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return {
        ...actual,
        readFile: vi.fn(async (path: string, enc?: string) => {
          if (path === './data/feedback/weekly-insights.json') {
            return JSON.stringify({
              week_start: '2026-06-01',
              learning_period_complete: true,
              hook_style_performance: [
                { style: '朋友推荐', tested: 5, replied: 1, rate: 0.2 },
                { style: '数据驱动', tested: 10, replied: 8, rate: 0.8 },
                { style: '顾问风格', tested: 4, replied: 2, rate: 0.5 },
              ],
            });
          }
          return actual.readFile(path as never, enc as never);
        }),
      };
    });
    vi.resetModules();

    const { generateHook: freshGenerateHook } = await import('../../src/rag/hook-generator.js');

    const lead = makeLead();
    const mockLLM = vi.fn().mockResolvedValue('测试钩子话术');
    vi.spyOn(await import('../../src/adapters/registry.js'), 'getLLM').mockReturnValue({
      complete: mockLLM,
    } as any);

    const result = await freshGenerateHook(mockProfile, lead, 'reply', opts);

    // 最高 rate 是 "数据驱动" (0.8)，且全部 tested >= 3
    expect(result.hookStyle).toBe('数据驱动');
    // 同时应写回 lead.hook_style
    expect((lead as any).hook_style).toBe('数据驱动');

    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });

  it('weekly-insights.json 存在但所有 style tested < 3 时回退到默认', async () => {
    // 边界条件：tested 不足时不采纳最优风格，使用默认
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return {
        ...actual,
        readFile: vi.fn(async (path: string, enc?: string) => {
          if (path === './data/feedback/weekly-insights.json') {
            return JSON.stringify({
              week_start: '2026-06-01',
              hook_style_performance: [
                { style: '高率但样本不足', tested: 2, replied: 2, rate: 1.0 },
                { style: '高率但样本不足2', tested: 1, replied: 1, rate: 1.0 },
              ],
            });
          }
          return actual.readFile(path as never, enc as never);
        }),
      };
    });
    vi.resetModules();

    const { generateHook: freshGenerateHook } = await import('../../src/rag/hook-generator.js');

    const lead = makeLead();
    const mockLLM = vi.fn().mockResolvedValue('测试钩子话术');
    vi.spyOn(await import('../../src/adapters/registry.js'), 'getLLM').mockReturnValue({
      complete: mockLLM,
    } as any);

    const result = await freshGenerateHook(mockProfile, lead, 'reply', opts);

    // tested < 3 全部被过滤 → 回退到 profile.hook_config.style
    expect(result.hookStyle).toBe('像朋友推荐，不像销售');

    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// 测试：retrieveTopK 检索
// ---------------------------------------------------------------------------

describe('retrieveTopK 检索', () => {
  it('db 目录不存在时返回空数组', async () => {
    // 当目录不存在时 better-sqlite3 抛出 TypeError
    const docs = await retrieveTopK(
      'AI 剪辑',
      3,
      './non-existent-dir/vectors.db',
      mockEmbeddingProvider,
    );
    expect(docs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 测试：cosine similarity 排序
// ---------------------------------------------------------------------------

describe('cosine similarity', () => {
  it('相似度计算正确', async () => {
    const { cosineSimilarity } = await import('../../src/rag/index-builder.js');

    // 相同向量：相似度 = 1
    const a = [0.1, 0.2, 0.3];
    const b = [0.1, 0.2, 0.3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);

    // 正交向量：相似度 ≈ 0
    const c = [1, 0, 0];
    const d = [0, 1, 0];
    expect(cosineSimilarity(c, d)).toBeCloseTo(0.0);

    // 相反向量：相似度 = -1
    const e = [1, 0, 0];
    const f = [-1, 0, 0];
    expect(cosineSimilarity(e, f)).toBeCloseTo(-1.0);
  });
});