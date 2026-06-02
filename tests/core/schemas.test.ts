/**
 * schemas.ts 单元测试
 *
 * 覆盖:
 *   - BusinessProfile / ChannelsConfig / ConversionConfig / CrmConfig
 *   - PipelineState / LeadEvent / WeeklyInsights / SafetyConfig / CommentInput
 *
 * 每个 schema 一 happy path + 一 invalid case (验证 safeParse 拒绝)
 */

import { describe, it, expect } from 'vitest';
import {
  BusinessProfileSchema,
  ChannelsConfigSchema,
  ConversionConfigSchema,
  CrmConfigSchema,
  PipelineStateSchema,
  LeadEventSchema,
  WeeklyInsightsSchema,
  SafetyConfigSchema,
  CommentInputSchema,
  formatZodError,
} from '../../src/core/schemas.js';

describe('BusinessProfileSchema', () => {
  const valid = {
    business: { name: '燃点 FDE', value_prop: 'AI 落地' },
    target_personas: [
      { id: 'p1', name: 'P1', typical_pain_points: ['痛点 1'] },
    ],
    intent_signals: ['信号 1'],
    llm: { provider: 'deepseek', model: 'v3', api_key_env: 'KEY' },
    crm: { type: 'feishu', config: { app_id_env: 'A' } },
  };

  it('accepts a valid profile', () => {
    const r = BusinessProfileSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it('rejects missing business.name', () => {
    const r = BusinessProfileSchema.safeParse({
      ...valid,
      business: { value_prop: 'x' },
    });
    expect(r.success).toBe(false);
  });
});

describe('ChannelsConfigSchema', () => {
  it('accepts a valid channels config', () => {
    const r = ChannelsConfigSchema.safeParse({
      source: { mode: 'sec_uid' },
      target_sec_uids: { sec_uids: [], user_videos_limit: 20 },
      search: { keywords: { 'AI 客服': { weight: 1.0 } } },
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid source.mode', () => {
    const r = ChannelsConfigSchema.safeParse({
      source: { mode: 'invalid_mode' },
    });
    expect(r.success).toBe(false);
  });
});

describe('ConversionConfigSchema', () => {
  it('accepts a valid conversion config', () => {
    const r = ConversionConfigSchema.safeParse({
      lifecycle_states: [
        { id: 'discovered', name: '新发现', is_terminal: false },
        { id: 'closed', name: '已成交', is_terminal: true },
      ],
      success_states: ['closed'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty lifecycle_states', () => {
    const r = ConversionConfigSchema.safeParse({
      lifecycle_states: [],
      success_states: [],
    });
    expect(r.success).toBe(false);
  });
});

describe('CrmConfigSchema', () => {
  it('accepts a valid crm config', () => {
    const r = CrmConfigSchema.safeParse({
      crm: {
        type: 'feishu',
        config: { app_id_env: 'A', app_secret_env: 'B', table_id: 'T' },
        field_mapping: { nickname: '昵称' },
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid crm.type', () => {
    const r = CrmConfigSchema.safeParse({
      crm: { type: 'invalid', config: {} },
    });
    expect(r.success).toBe(false);
  });
});

describe('PipelineStateSchema', () => {
  const validState = {
    date: '2026-06-01',
    currentStep: 0,
    steps: [{ name: 'reconnaissance', status: 'pending' }],
    startedAt: '2026-06-01T00:00:00.000Z',
    lastUpdatedAt: '2026-06-01T00:00:00.000Z',
    errors: [],
    completed: false,
  };

  it('accepts a valid pipeline state', () => {
    const r = PipelineStateSchema.safeParse(validState);
    expect(r.success).toBe(true);
  });

  it('rejects currentStep > 6', () => {
    const r = PipelineStateSchema.safeParse({ ...validState, currentStep: 99 });
    expect(r.success).toBe(false);
  });
});

describe('LeadEventSchema', () => {
  const valid = {
    event: 'lead_status_changed',
    cid: 'cid_1',
    keyword: 'kw',
    hook_style: '朋友推荐',
    hook_text: 'text',
    persona: 'p1',
    interaction_time: '2026-06-01T10:00:00.000Z',
  };

  it('accepts a valid lead event', () => {
    const r = LeadEventSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it('rejects unknown event type', () => {
    const r = LeadEventSchema.safeParse({ ...valid, event: 'unknown' });
    expect(r.success).toBe(false);
  });
});

describe('WeeklyInsightsSchema', () => {
  it('accepts a minimal insights object', () => {
    const r = WeeklyInsightsSchema.safeParse({
      week_start: '2026-05-31',
      learning_period_complete: false,
      generated_at: '2026-06-01T00:00:00.000Z',
    });
    expect(r.success).toBe(true);
  });

  it('rejects rate > 1 in hook_style_performance', () => {
    const r = WeeklyInsightsSchema.safeParse({
      week_start: '2026-05-31',
      learning_period_complete: true,
      generated_at: '2026-06-01T00:00:00.000Z',
      hook_style_performance: [
        { style: 'a', tested: 10, replied: 5, rate: 5.0 },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('SafetyConfigSchema', () => {
  it('accepts an empty safety config', () => {
    const r = SafetyConfigSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('rejects negative engagement_actions', () => {
    const r = SafetyConfigSchema.safeParse({
      daily_budget: { engagement_actions: -1 },
    });
    expect(r.success).toBe(false);
  });
});

describe('CommentInputSchema', () => {
  const validComment = {
    cid: 'c1',
    aweme_id: 'a1',
    video_url: 'https://example.com/v/1',
    video_desc: 'desc',
    keyword: 'kw',
    text: 'a real comment',
    user: { nickname: 'u', uid: 'u1', follower_count: 100, signature: 'sig' },
    digg_count: 5,
    create_time: '2026-06-01T10:00:00.000Z',
    reply_count: 0,
  };

  it('accepts a valid comment', () => {
    const r = CommentInputSchema.safeParse(validComment);
    expect(r.success).toBe(true);
  });

  it('rejects empty text', () => {
    const r = CommentInputSchema.safeParse({ ...validComment, text: '' });
    expect(r.success).toBe(false);
  });
});

describe('formatZodError', () => {
  it('produces a multi-line, prefixed error message', () => {
    const r = BusinessProfileSchema.safeParse({
      business: { name: '', value_prop: '' },
      target_personas: [],
      intent_signals: [],
      llm: { provider: 'deepseek', model: 'v3', api_key_env: 'K' },
      crm: { type: 'feishu', config: {} },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = formatZodError('profile.yaml', r.error);
      expect(msg).toContain('profile.yaml');
      expect(msg).toContain('校验失败');
    }
  });
});
