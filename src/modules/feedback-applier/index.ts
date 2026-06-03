/**
 * feedback-applier 主入口（Phase 2 #3 主动学习回路）
 *
 * 责任：
 *   1. 读 outcomes.jsonl（zod 校验 + 过滤）
 *   2. 30 天窗口聚合 + 移动平均
 *   3. 写回 channels.yaml personas[].value_score
 *   4. 顺手产出 learned-examples cache
 *
 * 失败 fail-loud：所有错误降级为 skipped + log warn，**绝不抛**
 */

import { join } from 'node:path';
import { loadOutcomes, filterOutcomesForTraining } from './outcomes-loader.js';
import { aggregateSignalsForPersona, applyMovingAverage } from './moving-average.js';
import { updatePersonaValueScores, readOldPersonaScores } from './channels-writer.js';
import { logger } from '../../core/logger.js';

export * from './outcomes-loader.js';
export * from './moving-average.js';
export * from './channels-writer.js';
export * from './learned-examples.js';

export interface FeedbackApplierOptions {
  businessDir: string;
  outcomesPath?: string;
  channelsPath?: string;
  learnedCachePath?: string;
  now?: Date;
}

export interface FeedbackApplierResult {
  outcomes_loaded: number;
  outcomes_filtered: number;
  personas_updated: number;
  duration_ms: number;
  skipped?: 'no_outcomes' | 'channels_unwritable' | 'file_missing' | 'parse_failed' | 'write_failed' | 'invalid_personas_section';
}

export async function applyOutcomeFeedback(
  opts: FeedbackApplierOptions,
): Promise<FeedbackApplierResult> {
  const t0 = Date.now();
  const outcomesPath = opts.outcomesPath ?? './data/feedback/outcomes.jsonl';
  const channelsPath = opts.channelsPath ?? join(opts.businessDir, 'channels.yaml');
  const learnedCachePath = opts.learnedCachePath ?? './data/feedback/learned-examples.json';
  const now = opts.now ?? new Date();

  try {
    const { outcomes, skipped_lines } = await loadOutcomes({ outcomesPath });
    const { kept, dropped } = filterOutcomesForTraining(outcomes, now);
    const outcomes_filtered = skipped_lines + dropped.length;

    if (kept.length === 0) {
      logger.info({ outcomes_loaded: outcomes.length, outcomes_filtered }, '无有效 outcome，跳过');
      return {
        outcomes_loaded: outcomes.length,
        outcomes_filtered,
        personas_updated: 0,
        duration_ms: Date.now() - t0,
        skipped: 'no_outcomes',
      };
    }

    const personaIds = Array.from(new Set(kept.map(o => o.persona_id)));
    const updates = personaIds.map(id => {
      const { signal, sampleSize } = aggregateSignalsForPersona(kept, id, now);
      return { id, signal, sampleSize };
    });

    const oldScores = await readOldPersonaScores(channelsPath);
    const valueUpdates = updates.map(u => ({
      id: u.id,
      value_score: applyMovingAverage(oldScores.get(u.id) ?? 5.0, u.signal, u.sampleSize),
      sample_size: u.sampleSize,
      updated_at: now.toISOString(),
    }));

    const writeR = await updatePersonaValueScores({ channelsPath, updates: valueUpdates });

    // V1.4: learned-examples 暂时跳过 — LeadOutcomeEvent schema 当前不含
    // comment_snippet / pain_point 字段，传空数组会污染 cache。等 schema
    // 扩展或从其他源（CRM 备注、聊天记录）补齐数据后再接入。
    // 保留 learnedCachePath 参数以便后续重新启用。

    return {
      outcomes_loaded: outcomes.length,
      outcomes_filtered,
      personas_updated: writeR.written,
      duration_ms: Date.now() - t0,
      skipped: writeR.skipped,
    };
  } catch (e) {
    logger.error({ err: e }, 'applyOutcomeFeedback 异常，降级返回');
    return {
      outcomes_loaded: 0,
      outcomes_filtered: 0,
      personas_updated: 0,
      duration_ms: Date.now() - t0,
      skipped: 'channels_unwritable',
    };
  }
}
