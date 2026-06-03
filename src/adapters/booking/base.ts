import type { Lead, LeadStatus } from '../../core/types.js';

export interface BookingEvent {
  cid: string;
  type: 'booked' | 'cancelled' | 'reminded';
  scheduledAt?: string;
  channel: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface BookingProvider {
  watchBookings(): AsyncIterable<BookingEvent>;

  ping(): Promise<boolean>;
}