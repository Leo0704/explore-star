/**
 * src/core/config-schemas.ts 单元测试
 *
 * 覆盖：
 *   - safetyConfigSchema: valid + 3 个 spec 钦点的 invalid case（0/-1/缺字段）
 *     + max<min / 空 emergency_stop / 空 fatal_signals / fatal_signals 包含空串
 *   - businessProfileSchema: valid + 4 个 invalid
 *   - formatZodError: 输出格式
 */

import { describe, it, expect } from 'vitest';
import {
  safetyConfigSchema,
  businessProfileSchema,
  formatZodError,
  ChannelRateLimitsSchema,
} from '../../src/core/config-schemas.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_SAFETY = {
  rate_limits: {
    douyin: {
      search_calls_per_hour: 10,
      user_videos_calls_per_hour: 30,
      friend_request_per_day: 5,
      dm_per_day: 10,
    },
    min_interval_seconds: 3,
    max_interval_seconds: 8,
  },
  daily_budget: {
    videos: 50,
    comments_scanned: 5000,
    leads_created: 200,
    engagement_actions: 20,
  },
  emergency_stop: 'config/EMERGENCY_STOP',
  fatal_signals: [
    'auth_wall_detected',
    'captcha_triggered_3_times_in_1h',
    'private_msg_rejected_2_times',
    'ip_changed_5_times',
  ],
};

const VALID_PROFILE = {
  business: { name: '测试业务', value_prop: '测试价值主张' },
  target_personas: [
    { id: 'p1', name: 'P1', typical_pain_points: ['痛点 1'] },
  ],
  intent_signals: ['信号 1'],
  llm: { provider: 'deepseek', model: 'deepseek-v3', api_key_env: 'DEEPSEEK_API_KEY' },
  crm: { type: 'feishu', config: { app_id_env: 'FEISHU_APP_ID' } },
};

// ---------------------------------------------------------------------------
// safetyConfigSchema
// ---------------------------------------------------------------------------

describe('safetyConfigSchema', () => {
  it('accepts a valid safety config', () => {
    const r = safetyConfigSchema.safeParse(VALID_SAFETY);
    expect(r.success).toBe(true);
  });

  it('rejects friend_request_per_day=0 (会卡死所有好友申请)', () => {
    const r = safetyConfigSchema.safeParse({
      ...VALID_SAFETY,
      rate_limits: {
        ...VALID_SAFETY.rate_limits,
        douyin: { ...VALID_SAFETY.rate_limits.douyin, friend_request_per_day: 0 },
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map(i => i.path.join('.'));
      expect(paths.some(p => p.includes('friend_request_per_day'))).toBe(true);
    }
  });

  it('rejects friend_request_per_day=-1 (会绕过限速)', () => {
    const r = safetyConfigSchema.safeParse({
      ...VALID_SAFETY,
      rate_limits: {
        ...VALID_SAFETY.rate_limits,
        douyin: { ...VALID_SAFETY.rate_limits.douyin, friend_request_per_day: -1 },
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map(i => i.path.join('.'));
      expect(paths.some(p => p.includes('friend_request_per_day'))).toBe(true);
    }
  });

  it('rejects missing required field (emergency_stop) — 缺字段会静默用默认值的根因', () => {
    const { emergency_stop: _es, ...withoutES } = VALID_SAFETY;
    const r = safetyConfigSchema.safeParse(withoutES);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map(i => i.path.join('.'));
      expect(paths).toContain('emergency_stop');
    }
  });

  it('rejects max_interval_seconds < min_interval_seconds', () => {
    const r = safetyConfigSchema.safeParse({
      ...VALID_SAFETY,
      rate_limits: {
        ...VALID_SAFETY.rate_limits,
        min_interval_seconds: 10,
        max_interval_seconds: 5,
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map(i => i.path.join('.'));
      expect(paths.some(p => p.includes('max_interval_seconds'))).toBe(true);
    }
  });

  it('rejects empty emergency_stop', () => {
    const r = safetyConfigSchema.safeParse({ ...VALID_SAFETY, emergency_stop: '' });
    expect(r.success).toBe(false);
  });

  it('rejects empty fatal_signals array', () => {
    const r = safetyConfigSchema.safeParse({ ...VALID_SAFETY, fatal_signals: [] });
    expect(r.success).toBe(false);
  });

  it('rejects empty string inside fatal_signals', () => {
    const r = safetyConfigSchema.safeParse({ ...VALID_SAFETY, fatal_signals: ['valid', ''] });
    expect(r.success).toBe(false);
  });

  it('rejects non-positive daily_budget fields', () => {
    const r = safetyConfigSchema.safeParse({
      ...VALID_SAFETY,
      daily_budget: { ...VALID_SAFETY.daily_budget, videos: 0 },
    });
    expect(r.success).toBe(false);
  });

  it('preserves passthrough fields (hook_review / browser)', () => {
    const r = safetyConfigSchema.safeParse({
      ...VALID_SAFETY,
      hook_review: { enabled: false },
      browser: { headless: false },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as any).hook_review).toEqual({ enabled: false });
      expect((r.data as any).browser).toEqual({ headless: false });
    }
  });
});

// ---------------------------------------------------------------------------
// businessProfileSchema
// ---------------------------------------------------------------------------

describe('businessProfileSchema', () => {
  it('accepts a valid profile', () => {
    const r = businessProfileSchema.safeParse(VALID_PROFILE);
    expect(r.success).toBe(true);
  });

  it('rejects empty business.name', () => {
    const r = businessProfileSchema.safeParse({
      ...VALID_PROFILE,
      business: { name: '', value_prop: 'x' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty business.value_prop', () => {
    const r = businessProfileSchema.safeParse({
      ...VALID_PROFILE,
      business: { name: 'n', value_prop: '' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty target_personas', () => {
    const r = businessProfileSchema.safeParse({
      ...VALID_PROFILE,
      target_personas: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid llm.provider', () => {
    const r = businessProfileSchema.safeParse({
      ...VALID_PROFILE,
      llm: { ...VALID_PROFILE.llm, provider: 'gpt-unknown' as any },
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty llm.api_key_env', () => {
    const r = businessProfileSchema.safeParse({
      ...VALID_PROFILE,
      llm: { ...VALID_PROFILE.llm, api_key_env: '' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty intent_signals', () => {
    const r = businessProfileSchema.safeParse({
      ...VALID_PROFILE,
      intent_signals: [],
    });
    expect(r.success).toBe(false);
  });

  it('accepts observability with default values', () => {
    const r = businessProfileSchema.safeParse({
      ...VALID_PROFILE,
      observability: { run_history: { enabled: true }, notifier: { enabled: true, channels: ['console'] } },
    });
    expect(r.success).toBe(true);
  });

  it('rejects observability.run_history.enabled !== boolean', () => {
    const r = businessProfileSchema.safeParse({
      ...VALID_PROFILE,
      observability: { run_history: { enabled: 'yes' as any } },
    });
    expect(r.success).toBe(false);
  });

  it('rejects observability.notifier.channels with non-string entries', () => {
    const r = businessProfileSchema.safeParse({
      ...VALID_PROFILE,
      observability: { notifier: { channels: [123 as any] } },
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatZodError
// ---------------------------------------------------------------------------

describe('formatZodError', () => {
  it('produces a multi-line, prefixed, Chinese-readable error', () => {
    const r = safetyConfigSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = formatZodError('config/safety.json', r.error);
      expect(msg).toContain('config/safety.json');
      expect(msg).toContain('校验失败');
      expect(msg).toMatch(/个问题/);
    }
  });
});

// ============================================================================
// ChannelRateLimits (channels.yaml — channel_rate_limits 块)
// ============================================================================

describe('ChannelRateLimitsSchema', () => {
  it('accepts valid', () => {
    const r = ChannelRateLimitsSchema.safeParse({
      douyin: { search_qps: 0.5, user_videos_qps: 0.2, comment_qps: 1.0, friend_request_per_day: 5, dm_per_day: 10 },
    });
    expect(r.success).toBe(true);
  });
  it('rejects negative qps', () => {
    const r = ChannelRateLimitsSchema.safeParse({ douyin: { search_qps: -1, user_videos_qps: 0.2, comment_qps: 1.0, friend_request_per_day: 5, dm_per_day: 10 } });
    expect(r.success).toBe(false);
  });
  it('accepts qps=0 (halt signal)', () => {
    const r = ChannelRateLimitsSchema.safeParse({ douyin: { search_qps: 0, user_videos_qps: 0.2, comment_qps: 1.0, friend_request_per_day: 5, dm_per_day: 10 } });
    expect(r.success).toBe(true);
  });
  it('rejects negative daily quota', () => {
    const r = ChannelRateLimitsSchema.safeParse({ douyin: { search_qps: 0.5, user_videos_qps: 0.2, comment_qps: 1.0, friend_request_per_day: -1, dm_per_day: 10 } });
    expect(r.success).toBe(false);
  });
});
