import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { logger } from '../../core/logger.js';

export const OutcomeEnum = z.enum(['converted', 'lost', 'unresponsive']);
export const SourceEnum = z.enum(['manual', 'crm_sync', 'auto_heuristic']);

export const LeadOutcomeEventSchema = z.object({
  lead_id: z.string().min(1),
  business: z.string().min(1),
  persona_id: z.string().min(1),
  outcome: OutcomeEnum,
  confidence: z.number().min(0).max(1),
  days_to_outcome: z.number().int().min(0).max(365),
  captured_at: z.string().datetime(),
  source: SourceEnum,
});

export type LeadOutcomeEvent = z.infer<typeof LeadOutcomeEventSchema>;

const WINDOW_DAYS = 30;
const MIN_CONFIDENCE = 0.6;
const MAX_DAYS_TO_OUTCOME = 180;

export interface LoadOutcomesResult {
  outcomes: LeadOutcomeEvent[];
  skipped_lines: number;
}

export interface LoadOutcomesOptions {
  outcomesPath: string;
}

export async function loadOutcomes(opts: LoadOutcomesOptions): Promise<LoadOutcomesResult> {
  let raw: string;
  try {
    raw = await readFile(opts.outcomesPath, 'utf-8');
  } catch {
    return { outcomes: [], skipped_lines: 0 };
  }

  const outcomes: LeadOutcomeEvent[] = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      logger.warn({ line: line.slice(0, 80) }, 'outcomes.jsonl 行 JSON 解析失败，跳过');
      skipped++;
      continue;
    }
    const r = LeadOutcomeEventSchema.safeParse(parsed);
    if (!r.success) {
      logger.warn({ issues: r.error.issues, line: line.slice(0, 80) }, 'outcomes.jsonl 行 zod 校验失败，跳过');
      skipped++;
      continue;
    }
    outcomes.push(r.data);
  }
  return { outcomes, skipped_lines: skipped };
}

export interface FilterResult {
  kept: LeadOutcomeEvent[];
  dropped: LeadOutcomeEvent[];
}

export function filterOutcomesForTraining(
  outcomes: LeadOutcomeEvent[],
  now: Date,
): FilterResult {
  const cutoffMs = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const kept: LeadOutcomeEvent[] = [];
  const dropped: LeadOutcomeEvent[] = [];
  for (const o of outcomes) {
    if (o.confidence < MIN_CONFIDENCE) { dropped.push(o); continue; }
    if (o.days_to_outcome > MAX_DAYS_TO_OUTCOME) { dropped.push(o); continue; }
    if (new Date(o.captured_at).getTime() < cutoffMs) { dropped.push(o); continue; }
    kept.push(o);
  }
  return { kept, dropped };
}
