import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookBooking } from '../../../src/adapters/booking/webhook.js';
import type { BookingEvent } from '../../../src/adapters/booking/base.js';

describe('WebhookBooking', () => {
  it('enqueue + watchBookings delivers event', async () => {
    const bp = new WebhookBooking();
    const event: BookingEvent = {
      cid: 'cid789',
      type: 'booked',
      scheduledAt: '2026-06-02T10:00:00Z',
      channel: 'webhook',
      occurredAt: '2026-06-01T12:00:00Z',
    };

    // Start watching first
    const watchPromise = (async () => {
      const events: BookingEvent[] = [];
      for await (const e of bp.watchBookings()) {
        events.push(e);
        if (events.length >= 1) break;
      }
      return events;
    })();

    // Enqueue after watch started
    await new Promise(resolve => setTimeout(resolve, 50));
    bp.enqueue(event);

    const results = await watchPromise;
    expect(results[0].cid).toBe('cid789');
    expect(results[0].type).toBe('booked');
  });

  it('ping always returns true', async () => {
    const bp = new WebhookBooking();
    await expect(bp.ping()).resolves.toBe(true);
  });

  it('delivers events in order', async () => {
    const bp = new WebhookBooking();
    const events: BookingEvent[] = [
      { cid: 'a', type: 'booked', channel: 'w', occurredAt: '2026-06-01T00:00:00Z' },
      { cid: 'b', type: 'booked', channel: 'w', occurredAt: '2026-06-01T00:01:00Z' },
    ];

    // Enqueue both events, then start watching - queue should already have items
    bp.enqueue(events[0]);
    bp.enqueue(events[1]);

    const results: BookingEvent[] = [];
    for await (const e of bp.watchBookings()) {
      results.push(e);
      if (results.length >= 2) break;
    }

    expect(results[0].cid).toBe('a');
    expect(results[1].cid).toBe('b');
  });
});