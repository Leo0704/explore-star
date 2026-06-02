/**
 * outcomes-loader 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOutcomes,
  filterOutcomesForTraining,
} from '../../../src/modules/feedback-applier/outcomes-loader.js';
import type { LeadOutcomeEvent } from '../../../src/modules/feedback-applier/outcomes-loader.js';

describe('outcomes-loader', () => {
  let tmpDir: string;
  const outcomesPath = () => join(tmpDir, 'outcomes.jsonl');

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `fb-loader-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(tmpDir, { recursive: true });
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  describe('loadOutcomes', () => {
    it('returns empty array when file does not exist', async () => {
      const r = await loadOutcomes({ outcomesPath: outcomesPath() });
      expect(r.outcomes).toEqual([]);
      expect(r.skipped_lines).toBe(0);
    });

    it('loads valid outcomes', async () => {
      const evt: LeadOutcomeEvent = {
        lead_id: 'l1', business: '/b', persona_id: 'p1',
        outcome: 'converted', confidence: 0.9, days_to_outcome: 5,
        captured_at: '2026-06-01T00:00:00Z', source: 'manual',
      };
      await writeFile(outcomesPath(), JSON.stringify(evt) + '\n');
      const r = await loadOutcomes({ outcomesPath: outcomesPath() });
      expect(r.outcomes).toHaveLength(1);
      expect(r.outcomes[0].lead_id).toBe('l1');
      expect(r.skipped_lines).toBe(0);
    });

    it('skips lines that fail zod validation', async () => {
      const valid: LeadOutcomeEvent = {
        lead_id: 'l1', business: '/b', persona_id: 'p1',
        outcome: 'converted', confidence: 0.9, days_to_outcome: 5,
        captured_at: '2026-06-01T00:00:00Z', source: 'manual',
      };
      const badJson = '{this is not json';
      const invalid = { lead_id: 'l2', outcome: 'unknown' };
      await writeFile(
        outcomesPath(),
        JSON.stringify(valid) + '\n' + badJson + '\n' + JSON.stringify(invalid) + '\n',
      );
      const r = await loadOutcomes({ outcomesPath: outcomesPath() });
      expect(r.outcomes).toHaveLength(1);
      expect(r.skipped_lines).toBe(2);
    });

    it('handles empty file', async () => {
      await writeFile(outcomesPath(), '');
      const r = await loadOutcomes({ outcomesPath: outcomesPath() });
      expect(r.outcomes).toEqual([]);
      expect(r.skipped_lines).toBe(0);
    });
  });

  describe('filterOutcomesForTraining', () => {
    const baseEvt: LeadOutcomeEvent = {
      lead_id: 'l1', business: '/b', persona_id: 'p1',
      outcome: 'converted', confidence: 0.9, days_to_outcome: 5,
      captured_at: '2026-06-01T00:00:00Z', source: 'manual',
    };

    it('drops confidence < 0.6', () => {
      const r = filterOutcomesForTraining([{ ...baseEvt, confidence: 0.59 }], new Date('2026-06-03'));
      expect(r.kept).toHaveLength(0);
      expect(r.dropped).toHaveLength(1);
    });

    it('keeps confidence >= 0.6 (boundary)', () => {
      const r = filterOutcomesForTraining([{ ...baseEvt, confidence: 0.6 }], new Date('2026-06-03'));
      expect(r.kept).toHaveLength(1);
    });

    it('drops days_to_outcome > 180', () => {
      const r = filterOutcomesForTraining([{ ...baseEvt, days_to_outcome: 181 }], new Date('2026-06-03'));
      expect(r.kept).toHaveLength(0);
    });

    it('keeps days_to_outcome = 180 (boundary)', () => {
      const r = filterOutcomesForTraining([{ ...baseEvt, days_to_outcome: 180 }], new Date('2026-06-03'));
      expect(r.kept).toHaveLength(1);
    });

    it('drops outcomes outside 30-day window', () => {
      const old: LeadOutcomeEvent = { ...baseEvt, captured_at: '2026-01-01T00:00:00Z' };
      const r = filterOutcomesForTraining([old], new Date('2026-06-03'));
      expect(r.kept).toHaveLength(0);
    });

    it('keeps outcomes inside 30-day window', () => {
      const recent: LeadOutcomeEvent = { ...baseEvt, captured_at: new Date('2026-06-02').toISOString() };
      const r = filterOutcomesForTraining([recent], new Date('2026-06-03'));
      expect(r.kept).toHaveLength(1);
    });
  });
});
