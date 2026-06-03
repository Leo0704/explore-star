/**
 * crm-sync 单元测试（§3.5）
 *
 * 覆盖：同步成功/失败/部分失败
 */

import { describe, it, expect } from 'vitest';
import { syncLeads } from '../../src/modules/crm-sync/index.js';
import type { Lead, CRMAdapter, SyncResult } from '../../src/core/types.js';

function mkLead(overrides: Partial<Lead> = {}): Lead {
  return {
    cid: `c${Math.random().toString(36).slice(2)}`,
    source: 'douyin_user_videos',
    aweme_id: 'v1',
    video_url: 'https://...',
    video_desc: 'desc',
    keyword: 'kw',
    nickname: 'Test',
    user_signature: '',
    follower_count: 0,
    user_uid: 'u1',
    comment_text: 'hi',
    comment_digg_count: 0,
    comment_create_time: new Date().toISOString(),
    is_target_persona: true,
    persona: 'self_media',
    pain_point: 'p',
    intent_score: 0.8,
    buying_stage: 'awareness',
    suggested_reply_hook: 'h1',
    suggested_dm_hook: 'h2',
    status: '新发现',
    status_history: [],
    execution_count: 0,
    response_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Mock CRM adapter
class MockCRM implements CRMAdapter {
  shouldFail: boolean = false;
  failCids: Set<string> = new Set();

  async syncLeads(leads: Lead[]): Promise<SyncResult> {
    if (this.shouldFail) {
      return {
        synced: 0,
        failed: leads.length,
        errors: leads.map(l => ({ cid: l.cid, error: 'CRM error' })),
      };
    }

    const errors: Array<{ cid: string; error: string }> = [];
    for (const lead of leads) {
      if (this.failCids.has(lead.cid)) {
        errors.push({ cid: lead.cid, error: 'Lead error' });
      }
    }

    return {
      synced: leads.length - errors.length,
      failed: errors.length,
      errors,
    };
  }

  async getLead(cid: string): Promise<Lead | null> { return null; }
  async updateStatus(cid: string, status: any, note?: string): Promise<void> {}
  async updateLeadFields(cid: string, fields: any): Promise<void> {}
  async listLeads(filter?: any): Promise<Lead[]> { return []; }
  async ping(): Promise<boolean> { return true; }
}

describe('crm-sync', () => {
  describe('syncLeads 成功', () => {
    it('全部同步成功', async () => {
      const crm = new MockCRM();
      const leads = [mkLead(), mkLead(), mkLead()];
      const report = await syncLeads(crm, leads);

      expect(report.total).toBe(3);
      expect(report.synced).toBe(3);
      expect(report.failed).toBe(0);
      expect(report.errors).toHaveLength(0);
    });

    it('空列表返回空报告', async () => {
      const crm = new MockCRM();
      const report = await syncLeads(crm, []);

      expect(report.total).toBe(0);
      expect(report.synced).toBe(0);
      expect(report.failed).toBe(0);
    });
  });

  describe('syncLeads 失败', () => {
    it('CRM 调用直接失败，全部归档', async () => {
      const crm = new MockCRM();
      crm.shouldFail = true;
      const leads = [mkLead(), mkLead()];
      const report = await syncLeads(crm, leads);

      expect(report.total).toBe(2);
      expect(report.synced).toBe(0);
      expect(report.failed).toBe(2);
      expect(report.failedCids).toContain(leads[0].cid);
      expect(report.failedCids).toContain(leads[1].cid);
    });
  });

  describe('syncLeads 部分失败', () => {
    it('部分失败时报告正确', async () => {
      const crm = new MockCRM();
      const leads = [mkLead({ cid: 'c1' }), mkLead({ cid: 'c2' }), mkLead({ cid: 'c3' })];
      crm.failCids.add('c2');

      const report = await syncLeads(crm, leads);

      expect(report.total).toBe(3);
      expect(report.synced).toBe(2);
      expect(report.failed).toBe(1);
      expect(report.failedCids).toEqual(['c2']);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].cid).toBe('c2');
    });

    it('全部失败', async () => {
      const crm = new MockCRM();
      crm.shouldFail = true;
      const leads = [mkLead(), mkLead()];
      const report = await syncLeads(crm, leads);

      expect(report.synced).toBe(0);
      expect(report.failed).toBe(2);
    });
  });
});