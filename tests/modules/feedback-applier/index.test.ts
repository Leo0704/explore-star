import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { applyOutcomeFeedback } from '../../../src/modules/feedback-applier/index.js';
import type { LeadOutcomeEvent } from '../../../src/modules/feedback-applier/outcomes-loader.js';

describe('applyOutcomeFeedback (e2e)', () => {
  let tmpDir: string;
  const outcomesPath = () => join(tmpDir, 'outcomes.jsonl');
  const channelsPath = () => join(tmpDir, 'channels.yaml');

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `fb-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(tmpDir, { recursive: true });
    await writeFile(channelsPath(), 'search:\n  keywords:\n    AI: 1.0\n');
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it('top 25% persona value_score - bottom 25% >= 0.5 after 200 fake outcomes', async () => {
    const make = (personaId: string, outcomes: ('converted' | 'lost' | 'unresponsive')[]): LeadOutcomeEvent[] =>
      outcomes.map((o, i) => ({
        lead_id: `${personaId}-${i}`,
        business: '/b',
        persona_id: personaId,
        outcome: o,
        confidence: 0.9,
        days_to_outcome: 5,
        captured_at: new Date(Date.now() - (i % 30) * 86400000).toISOString(),
        source: 'manual' as const,
      }));

    const events: LeadOutcomeEvent[] = [
      ...make('p_high',  Array(50).fill('converted' as const)),
      ...make('p_midhi', [...Array(30).fill('converted' as const), ...Array(10).fill('unresponsive' as const), ...Array(10).fill('lost' as const)]),
      ...make('p_midlo', [...Array(10).fill('converted' as const), ...Array(20).fill('unresponsive' as const), ...Array(20).fill('lost' as const)]),
      ...make('p_low',   Array(50).fill('lost' as const)),
      ...Array.from({ length: 50 }, (_, i) => ({
        lead_id: `noise-${i}`,
        business: '/b',
        persona_id: 'p_high',
        outcome: 'lost' as const,
        confidence: 0.3,
        days_to_outcome: 5,
        captured_at: '2026-06-01T00:00:00Z',
        source: 'manual' as const,
      })),
    ];

    await writeFile(outcomesPath(), events.map(JSON.stringify).join('\n'));

    const r = await applyOutcomeFeedback({
      businessDir: tmpDir,
      outcomesPath: outcomesPath(),
      channelsPath: channelsPath(),
      now: new Date(),
    });

    expect(r.outcomes_loaded).toBe(250);
    expect(r.outcomes_filtered).toBe(50);

    const written = YAML.parse(await readFile(channelsPath(), 'utf-8'));
    expect(written.personas).toBeDefined();
    const personas = ['p_high', 'p_midhi', 'p_midlo', 'p_low'];
    const scores = personas.map(id => ({
      id,
      score: written.personas.find((x: any) => x.id === id)?.value_score ?? 0,
    }));
    const sorted = [...scores].sort((a, b) => b.score - a.score);
    const top = sorted[0].score;
    const bottom = sorted[3].score;
    expect(top - bottom).toBeGreaterThanOrEqual(0.5);
  });

  it('returns skipped=no_outcomes when file missing', async () => {
    const r = await applyOutcomeFeedback({
      businessDir: tmpDir,
      outcomesPath: join(tmpDir, 'nonexistent.jsonl'),
      channelsPath: channelsPath(),
    });
    expect(r.skipped).toBe('no_outcomes');
    expect(r.outcomes_loaded).toBe(0);
  });

  it('never throws even with malformed outcomes.jsonl', async () => {
    await writeFile(outcomesPath(), 'not json\n{also bad\n' + JSON.stringify({
      lead_id: 'l1', business: '/b', persona_id: 'p1',
      outcome: 'converted', confidence: 0.9, days_to_outcome: 5,
      captured_at: new Date().toISOString(), source: 'manual',
    }));
    let r;
    try {
      r = await applyOutcomeFeedback({
        businessDir: tmpDir,
        outcomesPath: outcomesPath(),
        channelsPath: channelsPath(),
      });
    } catch (e) {
      throw new Error('should not throw: ' + (e as Error).message);
    }
    expect(r.outcomes_loaded).toBeGreaterThanOrEqual(1);
  });
});
