import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeishuCRM } from '../../../src/adapters/crm/feishu.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

const mockLead = {
  cid: 'cid456',
  nickname: '飞书用户',
  status: '新发现' as const,
  intent_score: 0.8,
  created_at: '2026-06-01T00:00:00Z',
};

describe('FeishuCRM', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.FEISHU_APP_ID = 'test-app-id';
    process.env.FEISHU_APP_SECRET = 'test-app-secret';
  });

  it('ping returns true when token ok', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tenant_access_token: 'tok', expire: 3600 }),
    });
    const crm = new FeishuCRM({ tableId: 'tbl1', appIdEnv: 'FEISHU_APP_ID', appSecretEnv: 'FEISHU_APP_SECRET', fieldMapping: {} });
    await expect(crm.ping()).resolves.toBe(true);
  });

  it('ping returns false when token fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const crm = new FeishuCRM({ tableId: 'tbl1', appIdEnv: 'FEISHU_APP_ID', appSecretEnv: 'FEISHU_APP_SECRET', fieldMapping: {} });
    await expect(crm.ping()).resolves.toBe(false);
  });

  it('updateStatus throws on HTTP 500', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tenant_access_token: 'tok', expire: 3600 }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { items: [{ record_id: 'rec1' }] } }),
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Internal Error' });
    const crm = new FeishuCRM({ tableId: 'tbl1', appIdEnv: 'FEISHU_APP_ID', appSecretEnv: 'FEISHU_APP_SECRET', fieldMapping: { status: '状态' } });
    await expect(crm.updateStatus('cid1', '已联系')).rejects.toThrow('飞书更新失败 500');
  });

  it('upsertLead calls PATCH when record exists', async () => {
    let methods: string[] = [];
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url.includes('/auth/v3/tenant_access_token')) {
        return { ok: true, json: async () => ({ tenant_access_token: 'tok', expire: 3600 }) };
      }
      if (url.includes('/records/search')) {
        return {
          ok: true,
          json: async () => ({ data: { items: [{ record_id: 'rec_exists' }] } }),
        };
      }
      if (url.includes('/rec_exists')) {
        methods.push('PUT');
        return { ok: true };
      }
      if (url.includes('/records') && opts?.method === 'POST') {
        methods.push('POST');
        return { ok: true };
      }
      return { ok: true, json: async () => ({}) };
    });

    const crm = new FeishuCRM({
      tableId: 'tbl1',
      appIdEnv: 'FEISHU_APP_ID',
      appSecretEnv: 'FEISHU_APP_SECRET',
      fieldMapping: { cid: 'CID', nickname: '昵称', status: '状态' },
    });
    await crm.syncLeads([mockLead]);

    expect(methods).not.toContain('POST');
    expect(methods).toContain('PUT');
  });

  it('upsertLead calls POST when record not found', async () => {
    let methods: string[] = [];
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url.includes('/auth/v3/tenant_access_token')) {
        return { ok: true, json: async () => ({ tenant_access_token: 'tok', expire: 3600 }) };
      }
      if (url.includes('/records/search')) {
        return { ok: true, json: async () => ({ data: { items: [] } }) };
      }
      if (url.includes('/records') && opts?.method === 'POST') {
        methods.push('POST');
        return { ok: true };
      }
      return { ok: true, json: async () => ({}) };
    });

    const crm = new FeishuCRM({
      tableId: 'tbl1',
      appIdEnv: 'FEISHU_APP_ID',
      appSecretEnv: 'FEISHU_APP_SECRET',
      fieldMapping: { cid: 'CID', nickname: '昵称', status: '状态' },
    });
    await crm.syncLeads([mockLead]);

    expect(methods).toContain('POST');
  });

  it('syncLeads reports failure on upsert error', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/auth/v3/tenant_access_token')) {
        return { ok: true, json: async () => ({ tenant_access_token: 'tok', expire: 3600 }) };
      }
      if (url.includes('/records/search')) {
        return { ok: true, json: async () => ({ data: { items: [] } }) };
      }
      return { ok: false, status: 500, text: async () => 'Server Error' };
    });

    const crm = new FeishuCRM({
      tableId: 'tbl1',
      appIdEnv: 'FEISHU_APP_ID',
      appSecretEnv: 'FEISHU_APP_SECRET',
      fieldMapping: { cid: 'CID' },
    });
    const result = await crm.syncLeads([mockLead]);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.cid).toBe('cid456');
  });
});