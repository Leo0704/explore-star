/**
 * 共享 fixture: makeEntry
 *
 * 用途：tests/orchestration/run-history.test.ts + tests/cli/status.test.ts
 */

import type { RunHistoryEntry } from '../../src/orchestration/run-history.js';

export function makeEntry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    run_id: crypto.randomUUID(),
    business: '/test/business',
    mode: 'full',
    dry_run: false,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 1000,
    exit_reason: 'completed',
    step_durations: {},
    phase_counts: { videos_scanned: 0, comments_collected: 0, leads_created: 0, tasks_generated: 0, tasks_executed: 0 },
    errors: [],
    ...overrides,
  };
}
