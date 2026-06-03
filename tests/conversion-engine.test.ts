/**
 * ConversionEngine 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Lead, CRMAdapter, ConversionConfig, BusinessProfile } from '../src/core/types.js';

// Mock CRM adapter
const mockCRM: CRMAdapter = {
  syncLeads: vi.fn().mockResolvedValue({ synced: 1, failed: 0, errors: [] }),
  getLead: vi.fn(),
  updateStatus: vi.fn().mockResolvedValue(undefined),
  listLeads: vi.fn().mockResolvedValue([]),
  ping: vi.fn().mockResolvedValue(true),
};

const mockConversion: ConversionConfig = {
  lifecycle_states: [
    { id: 'wechat_added', name: '已加微', is_terminal: false },
    { id: 'booked', name: '已预约', is_terminal: false },
    { id: 'closed', name: '已成交', is_terminal: true },
  ],
  success_states: ['closed'],
  post_add_asset: { type: 'pdf', name: '测试物料', path: './test.pdf' },
  booking_url: 'https://test.com/book',
  message_template: '{{nickname}} 您好，这是测试物料',
  booking_provider: { type: 'manual', config: {} },
  reactivation: { dormant_days: 30, max_attempts: 1, message_template: '测试再激活' },
  cost_per_lead: 5,
};

const mockProfile: BusinessProfile = {
  business: { name: '测试业务', value_prop: '测试价值主张' },
  target_personas: [],
  intent_signals: [],
  llm: { provider: 'openai', model: 'gpt-4o-mini', api_key_env: 'OPENAI_API_KEY' },
  crm: { type: 'csv', config: {} },
};

describe('ConversionEngine', () => {
  beforeEach(async () => {
    // 注册内置 Notifier（pushMaterial 默认用 console notifier）
    const { registerBuiltins } = await import('../src/adapters/registry.js');
    await registerBuiltins();
    vi.clearAllMocks();
  });

  // Test material-pusher
  describe('pushMaterial', () => {
    it('should skip if wechat_added_at is missing', async () => {
      const { pushMaterial } = await import('../src/modules/conversion-engine/material-pusher.js');
      const lead = createTestLead({ wechat_added_at: undefined });
      (mockCRM.getLead as any).mockResolvedValue(lead);

      const result = await pushMaterial(lead, {
        profile: mockProfile,
        conversion: mockConversion,
        crm: mockCRM,
      });

      expect(result.pushed).toBe(false);
      expect(result.reason).toContain('无 wechat_added_at');
    });

    it('should skip if within delay period', async () => {
      const { pushMaterial } = await import('../src/modules/conversion-engine/material-pusher.js');
      const now = new Date();
      const lead = createTestLead({
        wechat_added_at: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
      });

      const result = await pushMaterial(lead, {
        profile: mockProfile,
        conversion: mockConversion,
        crm: mockCRM,
        postAddDelayHours: 24,
      });

      expect(result.pushed).toBe(false);
      expect(result.reason).toContain('未到');
    });

    it('should push material after delay', async () => {
      const { pushMaterial } = await import('../src/modules/conversion-engine/material-pusher.js');
      const now = new Date();
      const lead = createTestLead({
        wechat_added_at: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(), // 48 hours ago
        status: '已加微',
      });

      const result = await pushMaterial(lead, {
        profile: mockProfile,
        conversion: mockConversion,
        crm: mockCRM,
        postAddDelayHours: 24,
      });

      expect(result.pushed).toBe(true);
    });

    // Bug 4 (P0): 物料推送 ≠ 预约。推送物料后不应把状态改为 '已预约'
    it('should NOT change status to 已预约 after pushing material', async () => {
      const { pushMaterial } = await import('../src/modules/conversion-engine/material-pusher.js');
      const now = new Date();
      const lead = createTestLead({
        wechat_added_at: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        status: '已加微',
      });

      const result = await pushMaterial(lead, {
        profile: mockProfile,
        conversion: mockConversion,
        crm: mockCRM,
        postAddDelayHours: 24,
      });

      expect(result.pushed).toBe(true);
      const calls = (mockCRM.updateStatus as any).mock.calls;
      const bookedCalls = calls.filter((args: unknown[]) => args[1] === '已预约');
      expect(bookedCalls).toHaveLength(0);
    });
  });

  // Bug 4 (P0)：handleWechatAdded 同样不应把状态改为 '已预约'
  describe('handleWechatAdded', () => {
    it('should NOT change status to 已预约 after pushing material', async () => {
      const { registerNotifier } = await import('../src/adapters/registry.js');
      registerNotifier('wechat', { send: vi.fn().mockResolvedValue(undefined) } as any);

      const { handleWechatAdded } = await import('../src/modules/conversion-engine/index.js');
      const now = new Date();
      const lead = createTestLead({
        wechat_added_at: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        status: '已加微',
      });

      const result = await handleWechatAdded(lead, {
        profile: mockProfile,
        conversion: mockConversion,
        crm: mockCRM,
        postAddDelayHours: 24,
      });

      expect(result.pushed).toBe(true);
      const calls = (mockCRM.updateStatus as any).mock.calls;
      const bookedCalls = calls.filter((args: unknown[]) => args[1] === '已预约');
      expect(bookedCalls).toHaveLength(0);
    });
  });

  // Test generateConversionReport
  describe('generateConversionReport', () => {
    it('should generate report with correct funnel', async () => {
      const { generateConversionReport } = await import('../src/modules/conversion-engine/material-pusher.js');

      const leads = [
        createTestLead({ cid: 'c1', created_at: new Date().toISOString() }),
        createTestLead({ cid: 'c2', created_at: new Date().toISOString() }),
      ];
      (mockCRM.listLeads as any).mockResolvedValue(leads);

      const report = await generateConversionReport(new Date().toISOString().slice(0, 10), {
        profile: mockProfile,
        conversion: mockConversion,
        crm: mockCRM,
      });

      expect(report.date).toBe(new Date().toISOString().slice(0, 10));
      expect(report.new_leads).toBe(2);
    });
  });
});

function createTestLead(overrides: Partial<Lead> = {}): Lead {
  return {
    cid: 'test-cid-' + Math.random(),
    source: 'douyin_search',
    aweme_id: 'test-aweme',
    video_url: 'https://test.com/video',
    video_desc: '测试视频',
    keyword: 'AI',
    nickname: '测试用户',
    user_signature: '',
    follower_count: 100,
    user_uid: 'test-uid',
    comment_text: '测试评论',
    comment_digg_count: 10,
    comment_create_time: new Date().toISOString(),
    is_target_persona: true,
    persona: 'test_persona',
    pain_point: '测试痛点',
    intent_score: 0.8,
    buying_stage: 'consideration',
    suggested_reply_hook: '测试钩子',
    suggested_dm_hook: '测试私信钩子',
    status: '新发现',
    status_history: [],
    execution_count: 0,
    response_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}