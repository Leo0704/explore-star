/**
 * src/cli/status.ts 单元测试
 *
 * 覆盖：
 *   - human 格式输出（7 天 run 数 / 失败率 / 平均耗时 / 错误 top 5）
 *   - json 格式输出
 *   - 0 run 时显示警告 + 退出码 1
 *   - 全部 run completed 时退出码 0
 *   - 有 failed run 时退出码 1
 */

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
    expect(output).toMatch(/2/);  // 2 runs
    expect(output).toMatch(/50\.0%/);  // 50% failure
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
    // decideExitCode 看"最近一次 run"——确保 failed 是最新的
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
