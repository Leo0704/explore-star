/**
 * learned-examples 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildLearnedExamples,
  writeLearnedExamplesCache,
} from '../../../src/modules/feedback-applier/learned-examples.js';
import type { LeadOutcomeEvent } from '../../../src/modules/feedback-applier/outcomes-loader.js';

describe('learned-examples', () => {
  let tmpDir: string;
  const cachePath = () => join(tmpDir, 'learned-examples.json');

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `learned-examples-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(tmpDir, { recursive: true });
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it('groups converted → positive and lost → negative', () => {
    const events: LeadOutcomeEvent[] = [
      { lead_id: 'l1', business: '/b', persona_id: 'p1', outcome: 'converted', confidence: 0.9, days_to_outcome: 5, captured_at: '2026-06-01T00:00:00Z', source: 'manual' },
      { lead_id: 'l2', business: '/b', persona_id: 'p1', outcome: 'lost', confidence: 0.9, days_to_outcome: 5, captured_at: '2026-06-01T00:00:00Z', source: 'manual' },
    ];
    const r = buildLearnedExamples(events, ['comment1', 'comment2'], ['pain1', 'pain2']);
    expect(r.learned_positive_patterns).toHaveLength(1);
    expect(r.learned_negative_examples).toHaveLength(1);
  });

  it('unresponsive goes to neither list (neutral)', () => {
    const events: LeadOutcomeEvent[] = [
      { lead_id: 'l1', business: '/b', persona_id: 'p1', outcome: 'unresponsive', confidence: 0.9, days_to_outcome: 5, captured_at: '2026-06-01T00:00:00Z', source: 'manual' },
    ];
    const r = buildLearnedExamples(events, ['c1'], ['p1']);
    expect(r.learned_positive_patterns).toHaveLength(0);
    expect(r.learned_negative_examples).toHaveLength(0);
  });

  it('truncates comment_snippet to 50 chars and pain_point to 30 chars', () => {
    const longComment = 'a'.repeat(100);
    const longPain = 'b'.repeat(50);
    const events: LeadOutcomeEvent[] = [
      { lead_id: 'l1', business: '/b', persona_id: 'p1', outcome: 'converted', confidence: 0.9, days_to_outcome: 5, captured_at: '2026-06-01T00:00:00Z', source: 'manual' },
    ];
    const r = buildLearnedExamples(events, [longComment], [longPain]);
    expect(r.learned_positive_patterns[0].comment_snippet).toHaveLength(50);
    expect(r.learned_positive_patterns[0].pain_point).toHaveLength(30);
  });

  it('writes cache file', async () => {
    const events: LeadOutcomeEvent[] = [
      { lead_id: 'l1', business: '/b', persona_id: 'p1', outcome: 'converted', confidence: 0.9, days_to_outcome: 5, captured_at: '2026-06-01T00:00:00Z', source: 'manual' },
    ];
    const r = buildLearnedExamples(events, ['c1'], ['p1']);
    await writeLearnedExamplesCache({ cachePath: cachePath(), ...r });
    const parsed = JSON.parse(await readFile(cachePath(), 'utf-8'));
    expect(parsed.learned_positive_patterns).toHaveLength(1);
    expect(parsed.generated_at).toBeDefined();
  });
});
