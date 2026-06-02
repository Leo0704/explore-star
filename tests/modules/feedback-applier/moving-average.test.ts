/**
 * moving-average 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateSignalsForPersona,
  applyMovingAverage,
  outcomeToSignal,
} from '../../../src/modules/feedback-applier/moving-average.js';
import type { LeadOutcomeEvent } from '../../../src/modules/feedback-applier/outcomes-loader.js';

describe('moving-average', () => {
  describe('outcomeToSignal', () => {
    it('converted → 1.0', () => expect(outcomeToSignal('converted')).toBe(1.0));
    it('unresponsive → 0.0', () => expect(outcomeToSignal('unresponsive')).toBe(0.0));
    it('lost → -0.3', () => expect(outcomeToSignal('lost')).toBe(-0.3));
  });

  describe('aggregateSignalsForPersona', () => {
    it('returns neutral 5.0 when no recent outcomes', () => {
      const r = aggregateSignalsForPersona([], 'p1', new Date('2026-06-03'));
      expect(r.signal).toBe(5.0);
      expect(r.sampleSize).toBe(0);
    });

    it('all converted → max 10', () => {
      const now = new Date('2026-06-03');
      const events: LeadOutcomeEvent[] = Array.from({ length: 5 }, (_, i) => ({
        lead_id: `l${i}`, business: '/b', persona_id: 'p1',
        outcome: 'converted', confidence: 0.9, days_to_outcome: 5,
        captured_at: new Date(now.getTime() - i * 86400000).toISOString(),
        source: 'manual',
      }));
      const r = aggregateSignalsForPersona(events, 'p1', now);
      expect(r.signal).toBe(10);
      expect(r.sampleSize).toBe(5);
    });

    it('all lost → min 0', () => {
      const now = new Date('2026-06-03');
      const events: LeadOutcomeEvent[] = Array.from({ length: 5 }, (_, i) => ({
        lead_id: `l${i}`, business: '/b', persona_id: 'p1',
        outcome: 'lost', confidence: 0.9, days_to_outcome: 5,
        captured_at: new Date(now.getTime() - i * 86400000).toISOString(),
        source: 'manual',
      }));
      const r = aggregateSignalsForPersona(events, 'p1', now);
      expect(r.signal).toBe(0);
    });

    it('excludes outcomes outside 30-day window', () => {
      const now = new Date('2026-06-03');
      const old: LeadOutcomeEvent = {
        lead_id: 'old', business: '/b', persona_id: 'p1',
        outcome: 'converted', confidence: 0.9, days_to_outcome: 5,
        captured_at: '2026-01-01T00:00:00Z',
        source: 'manual',
      };
      const recent: LeadOutcomeEvent = {
        ...old, lead_id: 'recent',
        captured_at: new Date(now.getTime() - 86400000).toISOString(),
      };
      const r = aggregateSignalsForPersona([old, recent], 'p1', now);
      expect(r.sampleSize).toBe(1);
    });

    it('filters by persona_id', () => {
      const now = new Date('2026-06-03');
      const events: LeadOutcomeEvent[] = [
        { lead_id: 'a', business: '/b', persona_id: 'p1', outcome: 'converted', confidence: 0.9, days_to_outcome: 5, captured_at: now.toISOString(), source: 'manual' },
        { lead_id: 'b', business: '/b', persona_id: 'p2', outcome: 'lost', confidence: 0.9, days_to_outcome: 5, captured_at: now.toISOString(), source: 'manual' },
      ];
      const r = aggregateSignalsForPersona(events, 'p1', now);
      expect(r.sampleSize).toBe(1);
      expect(r.signal).toBe(10);
    });

    it('mixed outcomes give intermediate signal', () => {
      const now = new Date('2026-06-03');
      const events: LeadOutcomeEvent[] = [
        { lead_id: 'a', business: '/b', persona_id: 'p1', outcome: 'converted', confidence: 0.9, days_to_outcome: 5, captured_at: now.toISOString(), source: 'manual' },
        { lead_id: 'b', business: '/b', persona_id: 'p1', outcome: 'converted', confidence: 0.9, days_to_outcome: 5, captured_at: now.toISOString(), source: 'manual' },
        { lead_id: 'c', business: '/b', persona_id: 'p1', outcome: 'lost', confidence: 0.9, days_to_outcome: 5, captured_at: now.toISOString(), source: 'manual' },
        { lead_id: 'd', business: '/b', persona_id: 'p1', outcome: 'lost', confidence: 0.9, days_to_outcome: 5, captured_at: now.toISOString(), source: 'manual' },
      ];
      const r = aggregateSignalsForPersona(events, 'p1', now);
      expect(r.signal).toBe(5);
    });
  });

  describe('applyMovingAverage', () => {
    it('keeps old score when sampleSize < 3 (cold start protection)', () => {
      expect(applyMovingAverage(7.5, 2.0, 0)).toBe(7.5);
      expect(applyMovingAverage(7.5, 2.0, 1)).toBe(7.5);
      expect(applyMovingAverage(7.5, 2.0, 2)).toBe(7.5);
    });

    it('blends 30% new + 70% old when sampleSize >= 3', () => {
      expect(applyMovingAverage(5, 9, 5)).toBe(6.2);
    });

    it('rounds to 1 decimal', () => {
      expect(applyMovingAverage(7.111, 8.333, 10)).toBe(7.5);
    });

    it('applies α=0.3 with old=10 new=0', () => {
      expect(applyMovingAverage(10, 0, 5)).toBe(7);
    });
  });
});
