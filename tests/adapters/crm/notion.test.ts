import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotionCRM } from '../../../src/adapters/crm/notion.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

const mockLead = {
  cid: 'cid123',
  nickname: '测试用户',
  status: '新发现' as const,
  intent_score: 0.8,
  created_at: '2026-06-01T00:00:00Z',
};

describe('NotionCRM', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.NOTION_API_KEY = 'test-notion-key';
  });

  it('ping returns true when API ok', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const crm = new NotionCRM({ databaseId: 'db1', fieldMapping: {} });
    await expect(crm.ping()).resolves.toBe(true);
  });

  it('ping returns false on error', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));
    const crm = new NotionCRM({ databaseId: 'db1', fieldMapping: {} });
    await expect(crm.ping()).resolves.toBe(false);
  });

  it('syncLeads happy path', async () => {
    let postCount = 0;
    fetchMock.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST' && url.includes('/databases/query')) {
        postCount++;
        return { ok: true, json: async () => ({ results: [] }) };
      }
      if (opts?.method === 'POST' && url.includes('/pages')) {
        return { ok: true, json: async () => ({ id: 'page1' }) };
      }
      if (opts?.method === 'PATCH') {
        return { ok: true };
      }
      return { ok: true, json: async () => ({}) };
    });

    const crm = new NotionCRM({
      databaseId: 'db1',
      fieldMapping: { cid: 'CID', nickname: '昵称', status: '状态' },
    });
    const result = await crm.syncLeads([mockLead]);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('syncLeads error path', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Error' });
    const crm = new NotionCRM({
      databaseId: 'db1',
      fieldMapping: { cid: 'CID' },
    });
    const result = await crm.syncLeads([mockLead]);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.cid).toBe('cid123');
  });

  it('updateStatus happy path', async () => {
    let patched = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/databases/query')) {
        return { ok: true, json: async () => ({ results: [{ id: 'page1', properties: {} }] }) };
      }
      if (url.includes('/pages/') && url.endsWith('/page1')) {
        patched = true;
        return { ok: true };
      }
      return { ok: true, json: async () => ({}) };
    });

    const crm = new NotionCRM({ databaseId: 'db1', fieldMapping: { status: '状态' } });
    await crm.updateStatus('cid123', '已关注');
    expect(patched).toBe(true);
  });

  it('updateStatus throws when lead not found', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const crm = new NotionCRM({ databaseId: 'db1', fieldMapping: { cid: 'CID' } });
    await expect(crm.updateStatus('notfound', '已关注')).rejects.toThrow('not found');
  });

  it('getLead returns null when not found', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const crm = new NotionCRM({ databaseId: 'db1', fieldMapping: { cid: 'CID' } });
    await expect(crm.getLead('notfound')).resolves.toBeNull();
  });

  it('requires NOTION_API_KEY', () => {
    delete process.env.NOTION_API_KEY;
    expect(() => new NotionCRM({ databaseId: 'db1', fieldMapping: {} })).toThrow('NOTION_API_KEY');
  });
});