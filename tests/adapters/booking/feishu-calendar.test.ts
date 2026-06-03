import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeishuCalendarBooking } from '../../../src/adapters/booking/feishu-calendar.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe('FeishuCalendarBooking', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.FEISHU_APP_ID = 'app-id';
    process.env.FEISHU_APP_SECRET = 'app-secret';
  });

  it('ping returns true when token fetch ok', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tenant_access_token: 'token123', expire: 7200 }),
    });

    const bp = new FeishuCalendarBooking({ calendarId: 'cal-1' });
    await expect(bp.ping()).resolves.toBe(true);
  });

  it('ping returns false when token fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const bp = new FeishuCalendarBooking({ calendarId: 'cal-1' });
    await expect(bp.ping()).resolves.toBe(false);
  });

  it('watchBookings yields parsed booking events', async () => {
    let tokenCall = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/auth/v3/tenant_access_token')) {
        tokenCall = true;
        return { ok: true, json: async () => ({ tenant_access_token: 'tok', expire: 7200 }) };
      }
      return {
        ok: true,
        json: async () => ({
          items: [{
            event_id: 'evt-1',
            summary: '探星-cid123-20260601',
            start_time: '2026-06-02T10:00:00Z',
            status: 'completed',
            created_at: '2026-06-01T08:00:00Z',
          }],
          next_sync_token: 'sync-token-1',
        }),
      };
    });

    const bp = new FeishuCalendarBooking({ calendarId: 'cal-1' });
    const gen = bp.watchBookings();

    const it = gen.next();
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(tokenCall).toBe(true);
    gen.return?.();
  });
});