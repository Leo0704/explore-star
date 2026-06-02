/**
 * insights CLI 加深：cost summary 页面测试
 *
 * Phase 2 #4:验证 printCostSummary 输出包含 "本月 LLM 成本" 段
 */

import { describe, it, expect, vi } from 'vitest';
import type { RunHistoryEntry } from '../../src/orchestration/run-history.js';

function makeEntry(over: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    run_id: 'r1',
    business: 'b',
    mode: 'full',
    dry_run: false,
    started_at: '2026-06-01T00:00:00Z',
    finished_at: '2026-06-01T00:01:00Z',
    duration_ms: 60000,
    exit_reason: 'completed',
    step_durations: {},
    phase_counts: { videos_scanned: 0, comments_collected: 0, leads_created: 0, tasks_generated: 0, tasks_executed: 0 },
    errors: [],
    cost_estimate: { prompt_tokens: 1000, completion_tokens: 500, estimated_cost_usd: 0.001 },
    ...over,
  };
}

describe('printCostSummary', () => {
  it('累加 entries 的 cost_estimate 并输出关键字段', async () => {
    const { printCostSummary } = await import('../../src/cli/insights.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printCostSummary([
      makeEntry(),
      makeEntry({
        cost_estimate: { prompt_tokens: 2000, completion_tokens: 800, estimated_cost_usd: 0.002 },
      }),
    ]);
    const allOut = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOut).toContain('本月 LLM 成本');
    expect(allOut).toContain('3,000');
    expect(allOut).toContain('0.0030');
    consoleSpy.mockRestore();
  });

  it('没有 cost_estimate 的 entry 当作 0', async () => {
    const { printCostSummary } = await import('../../src/cli/insights.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printCostSummary([makeEntry({ cost_estimate: undefined })]);
    const allOut = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOut).toContain('本月 LLM 成本');
    expect(allOut).toContain('0');
    consoleSpy.mockRestore();
  });

  it('空 entries 不抛', async () => {
    const { printCostSummary } = await import('../../src/cli/insights.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => printCostSummary([])).not.toThrow();
    consoleSpy.mockRestore();
  });
});
