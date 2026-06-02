/**
 * F12 修复测试：LeadEvent schema 扩展 + recordTouchpoint 字段重映射
 *
 * 覆盖:
 *   - LeadEventSchema 接受 event='touchpoint_sent'
 *   - LeadEventSchema 接受 event='touchpoint_replied'
 *   - recordTouchpoint 写入 events.jsonl 的事件能通过 LeadEventSchema 验证
 *   - recordTouchpoint 字段映射正确（action_type → touchpoint_type 等）
 *
 * 策略：process.chdir 到临时目录，让 recordEvent 默认写到 tmp/data/feedback/events.jsonl，
 * 然后读取该文件验证。这样符合 "no mock" 原则（走真实 fs）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LeadEventSchema } from '../../src/core/schemas.js';
import { createConversionEngine } from '../../src/modules/conversion-engine/index.js';
import type { BusinessProfile, ConversionConfig, CRMAdapter } from '../../src/core/types.js';

const readEvents = (path: string): any[] => {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map((l) => JSON.parse(l));
};

describe('F12: LeadEventSchema 触达事件扩展', () => {
  const baseValid = {
    cid: 'cid_1',
    keyword: '',
    hook_style: '',
    hook_text: '',
    persona: '',
    interaction_time: '2026-06-01T10:00:00.000Z',
  };

  it('accepts event=touchpoint_sent with touchpoint_type/channel', () => {
    const r = LeadEventSchema.safeParse({
      ...baseValid,
      event: 'touchpoint_sent',
      touchpoint_type: 'send_pdf',
      touchpoint_channel: 'wechat',
    });
    expect(r.success).toBe(true);
  });

  it('accepts event=touchpoint_replied with touchpoint_type and result', () => {
    const r = LeadEventSchema.safeParse({
      ...baseValid,
      event: 'touchpoint_replied',
      touchpoint_type: 'send_pdf',
      touchpoint_channel: 'wechat',
      touchpoint_result: 'replied',
    });
    expect(r.success).toBe(true);
  });

  it('accepts touchpoint_result enum values (opened/replied/booked/no_response)', () => {
    for (const result of ['opened', 'replied', 'booked', 'no_response']) {
      const r = LeadEventSchema.safeParse({
        ...baseValid,
        event: 'touchpoint_replied',
        touchpoint_type: 'send_pdf',
        touchpoint_channel: 'wechat',
        touchpoint_result: result,
      });
      expect(r.success).toBe(true);
    }
  });

  it('still rejects unknown event type', () => {
    const r = LeadEventSchema.safeParse({
      ...baseValid,
      event: 'unknown_event',
    });
    expect(r.success).toBe(false);
  });
});

describe('F12: recordTouchpoint 字段映射 + 事件类型', () => {
  let tmpDir: string;
  let prevCwd: string;
  let engine: ReturnType<typeof createConversionEngine>;
  let eventsPath: string;

  const fakeLead = {
    cid: 'cid_t1',
    nickname: '测试用户',
    platform: 'douyin' as const,
    profile_url: 'https://example.com/u/1',
    intent_score: 80,
    status: '已加微' as const,
    created_at: '2026-05-30T00:00:00.000Z',
    wechat_added_at: '2026-05-30T01:00:00.000Z',
    keyword: 'AI 客服',
  };

  const profile: BusinessProfile = {
    business: { name: '测试业务', value_prop: '测试' },
    target_personas: [],
    intent_signals: [],
    llm: { provider: 'deepseek', model: 'v3', api_key_env: 'KEY' },
    crm: { type: 'csv', config: { path: '/tmp/leads.csv' } },
  };

  const conversion: ConversionConfig = {
    lifecycle_states: [
      { id: 'discovered', name: '新发现', is_terminal: false },
      { id: 'closed', name: '已成交', is_terminal: true },
    ],
    success_states: ['closed'],
  };

  const crm: CRMAdapter = {
    listLeads: async () => [fakeLead],
    getLead: async (cid: string) => (cid === fakeLead.cid ? fakeLead : null),
    updateStatus: async () => undefined,
    upsertLead: async () => undefined,
  } as any;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'f12-'));
    eventsPath = join(tmpDir, 'data', 'feedback', 'events.jsonl');
    prevCwd = process.cwd();
    process.chdir(tmpDir);
    engine = createConversionEngine({ profile, conversion, crm });
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes event=touchpoint_sent (not lead_status_changed)', async () => {
    await engine.recordTouchpoint('cid_t1', {
      action_type: 'send_pdf',
      channel: 'wechat',
      content_summary: '推送了《AI 选型指南》PDF',
      sent_at: '2026-06-01T10:00:00.000Z',
    });
    const events = readEvents(eventsPath);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('touchpoint_sent');
  });

  it('maps fields correctly: action_type → touchpoint_type, channel → touchpoint_channel', async () => {
    await engine.recordTouchpoint('cid_t1', {
      action_type: 'send_pdf',
      channel: 'wechat',
      content_summary: '推送了《AI 选型指南》PDF',
      sent_at: '2026-06-01T10:00:00.000Z',
    });
    const ev = readEvents(eventsPath)[0];
    expect(ev.touchpoint_type).toBe('send_pdf');
    expect(ev.touchpoint_channel).toBe('wechat');
    expect(ev.cid).toBe('cid_t1');
    expect(ev.interaction_time).toBe('2026-06-01T10:00:00.000Z');
  });

  it('the written event passes LeadEventSchema validation', async () => {
    await engine.recordTouchpoint('cid_t1', {
      action_type: 'send_booking_link',
      channel: 'sms',
      content_summary: '发送预约链接',
      sent_at: '2026-06-01T11:00:00.000Z',
    });
    const ev = readEvents(eventsPath)[0];
    const r = LeadEventSchema.safeParse(ev);
    expect(r.success).toBe(true);
  });
});
