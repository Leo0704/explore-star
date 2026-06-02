/**
 * learned-examples cache（Phase 2 #3）
 *
 * 从 outcomes 生成 prompt 用的 positive/negative 样本，写 cache 文件
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LeadOutcomeEvent } from './outcomes-loader.js';

const MAX_COMMENT_SNIPPET = 50;
const MAX_PAIN_POINT = 30;

export interface LearnedExample {
  persona_id: string;
  comment_snippet: string;
  pain_point: string;
  outcome: 'converted' | 'lost' | 'unresponsive';
  days_to_outcome: number;
}

export interface LearnedExamples {
  learned_positive_patterns: LearnedExample[];
  learned_negative_examples: LearnedExample[];
}

export function buildLearnedExamples(
  outcomes: LeadOutcomeEvent[],
  comments: string[],
  painPoints: string[],
): LearnedExamples {
  const positive: LearnedExample[] = [];
  const negative: LearnedExample[] = [];
  outcomes.forEach((o, i) => {
    const ex: LearnedExample = {
      persona_id: o.persona_id,
      comment_snippet: truncate(comments[i] ?? '', MAX_COMMENT_SNIPPET),
      pain_point: truncate(painPoints[i] ?? '', MAX_PAIN_POINT),
      outcome: o.outcome,
      days_to_outcome: o.days_to_outcome,
    };
    if (o.outcome === 'converted') positive.push(ex);
    else if (o.outcome === 'lost') negative.push(ex);
  });
  return { learned_positive_patterns: positive, learned_negative_examples: negative };
}

export interface WriteCacheOptions {
  cachePath: string;
  learned_positive_patterns: LearnedExample[];
  learned_negative_examples: LearnedExample[];
}

export async function writeLearnedExamplesCache(opts: WriteCacheOptions): Promise<void> {
  await mkdir(dirname(opts.cachePath), { recursive: true });
  await writeFile(opts.cachePath, JSON.stringify({
    learned_positive_patterns: opts.learned_positive_patterns,
    learned_negative_examples: opts.learned_negative_examples,
    generated_at: new Date().toISOString(),
  }, null, 2), 'utf-8');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
