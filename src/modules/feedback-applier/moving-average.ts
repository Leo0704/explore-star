import type { LeadOutcomeEvent } from './outcomes-loader.js';

const WINDOW_DAYS = 30;
const ALPHA = 0.3;
const COLD_START_MIN_SAMPLES = 3;

export function outcomeToSignal(outcome: 'converted' | 'lost' | 'unresponsive'): number {
  if (outcome === 'converted') return 1.0;
  if (outcome === 'unresponsive') return 0.0;
  return -0.3;
}

export interface PersonaAggregate {
  signal: number;     // [0, 10]
  sampleSize: number;
}

export function aggregateSignalsForPersona(
  outcomes: LeadOutcomeEvent[],
  personaId: string,
  now: Date,
): PersonaAggregate {
  const cutoffMs = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = outcomes.filter(
    o => o.persona_id === personaId && new Date(o.captured_at).getTime() >= cutoffMs,
  );
  if (recent.length === 0) return { signal: 5.0, sampleSize: 0 };

  const sum = recent.reduce((s, o) => s + outcomeToSignal(o.outcome), 0);
  const mean = sum / recent.length;
  const mapped = Math.max(0, Math.min(10, ((mean + 0.3) / 1.3) * 10));
  return { signal: round1(mapped), sampleSize: recent.length };
}

export function applyMovingAverage(
  oldScore: number,
  newSignal: number,
  sampleSize: number,
): number {
  if (sampleSize < COLD_START_MIN_SAMPLES) return oldScore;
  return round1(ALPHA * newSignal + (1 - ALPHA) * oldScore);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
