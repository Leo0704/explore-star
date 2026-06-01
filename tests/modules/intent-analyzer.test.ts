/**
 * 意图分析器测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeComments } from '../../src/modules/intent-analyzer/index.js';
import { isMarketingAccount, filterMarketingComments } from '../../src/modules/intent-analyzer/marketing-filter.js';
import { loadPromptTemplates, compileIntentSystemPrompt, compileIntentUserPrompt } from '../../src/modules/intent-analyzer/prompts-loader.js';
import { analyzeBatch } from '../../src/modules/intent-analyzer/batch.js';
import type { Comment, BusinessProfile } from '../../src/core/types.js';

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
      description: '做多账号内容生产的小团队',
      typical_pain_points: ['AI 剪辑省人工', 'AI 写脚本质量稳定'],
    },
    {
      id: 'ecommerce',
      name: '电商',
      description: '电商品牌方/操盘手',
      typical_pain_points: ['AI 客服回复太机械', 'AI 生成商品图过不了审'],
    },
  ],
  intent_signals: ['AI 工具', '自动化', '降本增效'],
  buying_stages: [
    { id: 'awareness', name: '刚意识到问题', description: '表达困惑' },
    { id: 'consideration', name: '在调研比价', description: '在找 AI 工具' },
    { id: 'decision', name: '准备找人', description: '明确要做' },
  ],
  llm: { provider: 'deepseek', model: 'deepseek-v3', api_key_env: 'DEEPSEEK_API_KEY' },
  crm: { type: 'feishu', config: {} },
  hook_config: { style: '像朋友推荐', max_length: 30, language: '中文' },
};

// ---------------------------------------------------------------------------
// mock comments
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    cid: 'cid_' + Math.random(),
    aweme_id: 'aweme_123',
    video_url: 'https://douyin.com/video/123',
    video_desc: 'AI 工具推荐视频',
    keyword: 'AI 工具',
    text: '这个 AI 工具真的好用，省了我很多时间',
    user: {
      nickname: '真实用户',
      uid: 'uid_123',
      follower_count: 5000,
      signature: '分享好用的工具',
    },
    digg_count: 50,
    create_time: '1717200500',
    reply_count: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 测试：营销号过滤
// ---------------------------------------------------------------------------

describe('营销号过滤', () => {
  it('识别营销号昵称格式', () => {
    expect(isMarketingAccount('A123456', '').isMarketing).toBe(true);
    expect(isMarketingAccount('某猫AI客服', '').isMarketing).toBe(true);
    expect(isMarketingAccount('代购小王', '').isMarketing).toBe(true);
    expect(isMarketingAccount('AI工具爱好者', '').isMarketing).toBe(false);
  });

  it('识别营销号签名', () => {
    expect(isMarketingAccount('真实用户', '加我微信: xxx').isMarketing).toBe(true);
    expect(isMarketingAccount('真实用户', '低价代购，量大从优').isMarketing).toBe(true);
    expect(isMarketingAccount('真实用户', '普通用户签名').isMarketing).toBe(false);
  });

  it('filterMarketingComments 过滤掉营销号，保留正常用户', () => {
    const comments: Comment[] = [
      makeComment({ cid: 'c1', user: { nickname: 'A999', uid: 'u1', follower_count: 100, signature: '' } }),
      makeComment({ cid: 'c2', user: { nickname: '普通用户', uid: 'u2', follower_count: 100, signature: '' } }),
      makeComment({ cid: 'c3', user: { nickname: 'AI助手', uid: 'u3', follower_count: 100, signature: '加微: xxx' } }),
    ];

    const { kept, filtered } = filterMarketingComments(comments);
    expect(kept).toHaveLength(1);
    expect(kept[0].cid).toBe('c2');
    expect(filtered).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 测试：模板渲染
// ---------------------------------------------------------------------------

describe('Prompt 模板渲染', () => {
  const promptsDir = './business.example/燃点-FDE/prompts';

  it('loadPromptTemplates 加载所有 4 个模板', async () => {
    const tpls = await loadPromptTemplates(promptsDir);
    expect(tpls.intentSystem).toBeTruthy();
    expect(tpls.intentUser).toBeTruthy();
    expect(tpls.hookReply).toBeTruthy();
    expect(tpls.hookDm).toBeTruthy();
  });

  it('compileIntentSystemPrompt 正确注入业务画像', async () => {
    const tpls = await loadPromptTemplates(promptsDir);
    const rendered = compileIntentSystemPrompt(tpls.intentSystem, { business: mockProfile });
    expect(rendered).toContain('燃点 FDE');
    expect(rendered).toContain('自媒体矩阵');
    expect(rendered).toContain('AI 工具');
  });

  it('compileIntentUserPrompt 正确注入评论上下文', async () => {
    const tpls = await loadPromptTemplates(promptsDir);
    const rendered = compileIntentUserPrompt(tpls.intentUser, {
      video_desc: 'AI 工具推荐',
      video_url: 'https://douyin.com/video/123',
      nickname: '测试用户',
      user_signature: '普通用户',
      follower_count: 1000,
      comment_text: '这个工具真的好用',
    });
    expect(rendered).toContain('AI 工具推荐');
    expect(rendered).toContain('测试用户');
    expect(rendered).toContain('这个工具真的好用');
  });
});

// ---------------------------------------------------------------------------
// 测试：analyzeBatch 阈值过滤
// ---------------------------------------------------------------------------

describe('analyzeBatch 批处理', () => {
  it('intent_score < threshold 时正确 reject', async () => {
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify([
        { is_target_persona: true, persona: 'self_media', pain_point: 'AI 剪辑省人工', intent_score: 0.5, buying_stage: 'awareness', suggested_reply_hook: '赞', suggested_dm_hook: 'hi' },
        { is_target_persona: true, persona: 'self_media', pain_point: 'AI 写脚本稳定', intent_score: 0.8, buying_stage: 'consideration', suggested_reply_hook: '赞2', suggested_dm_hook: 'hi2' },
      ]),
    );

    const comments = [makeComment({ cid: 'c1' }), makeComment({ cid: 'c2' })];
    const { leads, rejected } = await analyzeBatch(comments, {
      profile: mockProfile,
      systemPrompt: 'system',
      userTplStr: '{{comment_text}}',
      llm: mockLLM,
      threshold: 0.7,
    });

    expect(leads).toHaveLength(1); // 只有 0.8 的那条
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('低于阈值');
  });

  it('非目标人设时正确 reject', async () => {
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify([
        { is_target_persona: false, persona: '', pain_point: '', intent_score: 0.9, buying_stage: 'awareness', suggested_reply_hook: '', suggested_dm_hook: '' },
      ]),
    );

    const comments = [makeComment({ cid: 'c1' })];
    const { leads, rejected } = await analyzeBatch(comments, {
      profile: mockProfile,
      systemPrompt: 'system',
      userTplStr: '{{comment_text}}',
      llm: mockLLM,
      threshold: 0.7,
    });

    expect(leads).toHaveLength(0);
    expect(rejected[0].reason).toContain('不是目标人设');
  });

  it('未知 persona 时正确 reject', async () => {
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify([
        { is_target_persona: true, persona: 'unknown_persona', pain_point: '痛点', intent_score: 0.9, buying_stage: 'awareness', suggested_reply_hook: '钩子', suggested_dm_hook: '私信' },
      ]),
    );

    const comments = [makeComment({ cid: 'c1' })];
    const { leads, rejected } = await analyzeBatch(comments, {
      profile: mockProfile,
      systemPrompt: 'system',
      userTplStr: '{{comment_text}}',
      llm: mockLLM,
      threshold: 0.7,
    });

    expect(leads).toHaveLength(0);
    expect(rejected[0].reason).toContain('未知 persona');
  });

  it('LLM 调用失败时全部 reject', async () => {
    const mockLLM = vi.fn().mockRejectedValue(new Error('LLM error'));

    const comments = [makeComment({ cid: 'c1' }), makeComment({ cid: 'c2' })];
    const { leads, rejected, llmErrors } = await analyzeBatch(comments, {
      profile: mockProfile,
      systemPrompt: 'system',
      userTplStr: '{{comment_text}}',
      llm: mockLLM,
      threshold: 0.7,
    });

    expect(leads).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(llmErrors).toBe(1);
  });

  it('LLM 返回结果正确构建 lead', async () => {
    const mockLLM = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          is_target_persona: true,
          persona: 'self_media',
          pain_point: 'AI 剪辑省人工',
          intent_score: 0.85,
          buying_stage: 'decision',
          suggested_reply_hook: '我们给某 MCN 做了 AI 剪辑...',
          suggested_dm_hook: '看了你这条评论，想起了我们给某 MCN...',
        },
      ]),
    );

    const comments = [
      makeComment({ cid: 'c1', keyword: 'AI 工具', aweme_id: 'vid_abc' }),
    ];

    const { leads } = await analyzeBatch(comments, {
      profile: mockProfile,
      systemPrompt: 'system',
      userTplStr: '{{comment_text}}',
      llm: mockLLM,
      threshold: 0.7,
    });

    expect(leads).toHaveLength(1);
    expect(leads[0].keyword).toBe('AI 工具');  // 来源归因
    expect(leads[0].aweme_id).toBe('vid_abc');
    expect(leads[0].is_target_persona).toBe(true);
    expect(leads[0].persona).toBe('self_media');
    expect(leads[0].intent_score).toBe(0.85);
  });

  it('返回 rejected 和 llmErrors 计数', async () => {
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify([]));

    const comments = Array.from({ length: 10 }, (_, i) => makeComment({ cid: `c${i}` }));
    const { leads, rejected, llmErrors } = await analyzeBatch(comments, {
      profile: mockProfile,
      systemPrompt: 'system',
      userTplStr: '{{comment_text}}',
      llm: mockLLM,
      threshold: 0.7,
    });

    expect(leads).toHaveLength(0);
    expect(rejected).toHaveLength(10);
    expect(llmErrors).toBe(0); // JSON 解析成功，只是所有条目的 intent_score < threshold
  });
});

// ---------------------------------------------------------------------------
// 测试：analyzeComments 集成
// ---------------------------------------------------------------------------

describe('analyzeComments 集成', () => {
  it('filterMarketing=false 不过滤营销号', async () => {
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify([]));
    const comments: Comment[] = [
      makeComment({ cid: 'c1', user: { nickname: 'A999', uid: 'u1', follower_count: 100, signature: '' } }),
    ];

    const result = await analyzeComments(comments, {
      profile: mockProfile,
      promptsDir: './business.example/燃点-FDE/prompts',
      filterMarketing: false,
      llmOverride: mockLLM,
    });

    expect(result.marketingFiltered).toBe(0);
    expect(result.stats.inputComments).toBe(1);
  });
});