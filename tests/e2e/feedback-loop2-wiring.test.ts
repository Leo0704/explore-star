/**
 * 回路 2 闭环测试（§3.11 Loop 2）
 *
 * 验证：周分析产出的"最优钩子风格"真的被注入到下一批 LLM 调用。
 *
 * 关键问题（基于实际代码观察）：
 *   - run-daily.ts:193-205 调用 selectBestHookStyle() 拿最优风格
 *   - 传给 BatchContext.hookStyle
 *   - batch.ts:153 在 buildLead 里给 lead.hook_style 字段打标
 *   - ❓ 关键：hookStyle 是否被注入到 LLM prompt 本身？
 *
 * 本测试断言实际行为，避免"我描述的"和"代码做的"对不上。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Comment, BusinessProfile, WeeklyInsights } from '../../src/core/types.js';

const mockProfile: BusinessProfile = {
  business: { name: '燃点 FDE', value_prop: '派工程师做 AI 落地' },
  target_personas: [
    { id: 'self_media', name: '自媒体', description: '多账号内容生产', typical_pain_points: ['AI 剪辑'] },
  ],
  intent_signals: ['AI 工具'],
  buying_stages: [
    { id: 'awareness', name: '刚意识到问题', description: '表达困惑' },
  ],
  llm: { provider: 'deepseek', model: 'deepseek-v3', api_key_env: 'DEEPSEEK_API_KEY' },
  crm: { type: 'feishu', config: {} },
  hook_config: { style: '像朋友推荐', max_length: 30, language: '中文' },
};

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    cid: 'c_' + Math.random().toString(36).slice(2, 8),
    aweme_id: 'aweme_1',
    video_url: 'https://douyin.com/video/1',
    video_desc: 'AI 工具推荐',
    keyword: 'AI 工具',
    text: '求推荐好用的 AI 工具',
    user: { nickname: '真实用户', uid: 'u1', follower_count: 1000, signature: '' },
    digg_count: 10,
    create_time: '1717200500',
    reply_count: 0,
    ...overrides,
  };
}

describe('回路 2 闭环：feedback → 下一批 LLM', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await mkdtemp(join(tmpdir(), 'feedback-loop2-'));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('selectBestHookStyle 优先级：insights (≥3 测试) > profile.hook_config.style > 默认', async () => {
    // 准备一份 weekly-insights.json，钩子风格「数据派案例」tested=10 replied=8 rate=0.8
    const insights: WeeklyInsights = {
      week_start: '2026-06-02',
      learning_period_complete: true,
      hook_style_performance: [
        { style: '像朋友推荐', tested: 10, replied: 4, rate: 0.4 },
        { style: '数据派案例', tested: 10, replied: 8, rate: 0.8 },
      ],
      keyword_performance: [],
      persona_value: [],
      best_interaction_times: [],
      generated_at: new Date().toISOString(),
    };
    await mkdir(join(tempDir, 'data/feedback'), { recursive: true });
    await writeFile(
      join(tempDir, 'data/feedback/weekly-insights.json'),
      JSON.stringify(insights),
      'utf-8',
    );

    const { selectBestHookStyle } = await import('../../src/modules/nurture-engine/feedback-loader.js');
    const result = await selectBestHookStyle();
    expect(result).toBe('数据派案例');
  });

  it('selectBestHookStyle 在测试 < 3 次时返回 null（冷启动兜底）', async () => {
    const insights: WeeklyInsights = {
      week_start: '2026-06-02',
      learning_period_complete: false,
      hook_style_performance: [
        { style: '样本不足', tested: 2, replied: 1, rate: 0.5 },
      ],
      keyword_performance: [],
      persona_value: [],
      best_interaction_times: [],
      generated_at: new Date().toISOString(),
    };
    await mkdir(join(tempDir, 'data/feedback'), { recursive: true });
    await writeFile(
      join(tempDir, 'data/feedback/weekly-insights.json'),
      JSON.stringify(insights),
      'utf-8',
    );

    const { selectBestHookStyle } = await import('../../src/modules/nurture-engine/feedback-loader.js');
    const result = await selectBestHookStyle();
    expect(result).toBeNull();
  });

  it('【关键】analyzeBatch 收到 hookStyle 后，导出的 lead 被打上该风格（归因闭环）', async () => {
    // mock LLM：返回标准 JSON（用最简 systemPrompt/userTplStr 避免依赖 prompts 目录）
    const llmMock = {
      complete: vi.fn().mockResolvedValue(JSON.stringify([
        {
          is_target_persona: true,
          persona: 'self_media',
          pain_point: '想找 AI 剪辑工具',
          intent_score: 0.85,
          buying_stage: 'awareness',
          suggested_reply_hook: '试试这个',
          suggested_dm_hook: '你好',
        },
      ])),
    };

    const { analyzeBatch } = await import('../../src/modules/intent-analyzer/batch.js');

    const result = await analyzeBatch([makeComment()], {
      profile: mockProfile,
      systemPrompt: '你是分析师',
      userTplStr: '{{#each comments}}{{video_desc}}\n{{/each}}',
      llm: llmMock,
      threshold: 0.7,
      hookStyle: '数据派案例',  // 模拟 selectBestHookStyle 的输出
    });

    expect(result.leads).toHaveLength(1);
    // 关键断言：lead.hook_style 被打上 "数据派案例"
    expect(result.leads[0].hook_style).toBe('数据派案例');
  });

});
