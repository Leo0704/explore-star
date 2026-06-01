import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AirtableCRM } from '../../../src/adapters/crm/airtable.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

const mockLead = {
  cid: 'cid456',
  nickname: 'Airtable用户',
  status: '新发现' as const,
  intent_score: 0.9,
  created_at: '2026-06-01T00:00:00Z',
};

describe('AirtableCRM', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.AIRTABLE_API_KEY = 'test-key';
    process.env.AIRTABLE_BASE_ID = 'base1';
  });

  it('ping returns true when ok', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const crm = new AirtableCRM({ tableName: 'Leads', fieldMapping: {} });
    await expect(crm.ping()).resolves.toBe(true);
  });

  it('ping returns false on error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const crm = new AirtableCRM({ tableName: 'Leads', fieldMapping: {} });
    await expect(crm.ping()).resolves.toBe(false);
  });

  it('syncLeads happy path', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ records: [] }) });
    const crm = new AirtableCRM({
      tableName: 'Leads',
      fieldMapping: { cid: 'CID', nickname: '昵称' },
    });
    const result = await crm.syncLeads([mockLead]);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('syncLeads error path', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Error' });
    const crm = new AirtableCRM({
      tableName: 'Leads',
      fieldMapping: { cid: 'CID' },
    });
    const result = await crm.syncLeads([mockLead]);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.cid).toBe('cid456');
  });

  it('updateStatus happy path', async () => {
    let patched = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/Leads?')) {
        return { ok: true, json: async () => ({ records: [{ id: 'rec1', fields: {} }] }) };
      }
      if (url.includes('/rec1')) {
        patched = true;
        return { ok: true };
      }
      return { ok: true, json: async () => ({}) };
    });

    const crm = new AirtableCRM({ tableName: 'Leads', fieldMapping: { cid: 'CID', status: '状态' } });
    await crm.updateStatus('cid456', '已关注', '备注');
    expect(patched).toBe(true);
  });

  it('getLead returns null when not found', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ records: [] }) });
    const crm = new AirtableCRM({ tableName: 'Leads', fieldMapping: { cid: 'CID' } });
    await expect(crm.getLead('notfound')).resolves.toBeNull();
  });

  it('requires AIRTABLE_API_KEY', () => {
    delete process.env.AIRTABLE_API_KEY;
    expect(() => new AirtableCRM({ tableName: 'Leads', fieldMapping: {} })).toThrow('AIRTABLE_API_KEY');
  });

  it('requires AIRTABLE_BASE_ID', () => {
    delete process.env.AIRTABLE_BASE_ID;
    expect(() => new AirtableCRM({ tableName: 'Leads', fieldMapping: {} })).toThrow('AIRTABLE_BASE_ID');
  });
});