import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatStatusHuman, formatStatusJson, decideExitCode } from '../../src/cli/status.js';
import { appendRunHistory, readRunHistory } from '../../src/orchestration/run-history.js';
import { makeEntry } from '../_helpers/run-history-fixture.js';

let tmpDir: string;
let historyPath: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'status-test-'));
  historyPath = join(tmpDir, 'run_history.jsonl');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('formatStatusHuman', () => {
  it('includes run count and failure rate', async () => {
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'completed' }));
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'failed' }));
    const entries = await readRunHistory(historyPath);
    const output = formatStatusHuman({ business: 'test', days: 7, entries });
    expect(output).toMatch(/Run 总数/);
    expect(output).toMatch(/失败数/);
    expect(output).toMatch(/2/);
    expect(output).toMatch(/50\.0%/);
  });
});

describe('formatStatusJson', () => {
  it('produces valid JSON with structured fields', async () => {
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'completed' }));
    const entries = await readRunHistory(historyPath);
    const output = formatStatusJson({ business: 'test', days: 7, entries });
    const parsed = JSON.parse(output);
    expect(parsed.business).toBe('test');
    expect(parsed.days).toBe(7);
    expect(parsed.stats.totalRuns).toBe(1);
  });
});

describe('decideExitCode', () => {
  it('returns 0 when all runs are completed', () => {
    const entries = [makeEntry({ exit_reason: 'completed' })];
    expect(decideExitCode(entries, false)).toBe(0);
  });

  it('returns 1 when the most recent run is failed', () => {
    const baseTs = Date.now();
    const entries = [
      makeEntry({ exit_reason: 'completed', started_at: new Date(baseTs - 60_000).toISOString() }),
      makeEntry({ exit_reason: 'failed', started_at: new Date(baseTs).toISOString() }),
    ];
    expect(decideExitCode(entries, false)).toBe(1);
  });

  it('returns 1 when no runs and neverRunBefore is false (停跑)', () => {
    expect(decideExitCode([], false)).toBe(1);
  });

  it('returns 0 when no runs and neverRunBefore is true (从未跑过，不算异常)', () => {
    expect(decideExitCode([], true)).toBe(0);
  });
});
