/**
 * src/orchestration/run-history.ts 单元测试
 *
 * 覆盖：
 *   - appendRunHistory: 原子写（tmp + rename）+ append
 *   - readRunHistory: 过滤坏行（log warn 跳过）+ 按时间倒序 + sinceDays 过滤
 *   - summaryStats: run 数 / 失败数 / 错误聚合 top 5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendRunHistory,
  readRunHistory,
  summaryStats,
} from '../../src/orchestration/run-history.js';
import { makeEntry } from '../_helpers/run-history-fixture.js';

let tmpDir: string;
let historyPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'run-history-test-'));
  historyPath = join(tmpDir, 'run_history.jsonl');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('appendRunHistory', () => {
  it('appends an entry to a new file', async () => {
    await appendRunHistory(historyPath, makeEntry());
    const content = readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.exit_reason).toBe('completed');
  });

  it('appends to existing file (multiple entries)', async () => {
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'completed' }));
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'failed' }));
    const content = readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(2);
  });

  it('uses atomic write (tmp + rename) — no .tmp file remains after success', async () => {
    await appendRunHistory(historyPath, makeEntry());
    const tmpFile = `${historyPath}.tmp.${process.pid}`;
    expect(existsSync(tmpFile)).toBe(false);
  });

  it('creates parent dir if missing', async () => {
    const nestedPath = join(tmpDir, 'nested', 'subdir', 'history.jsonl');
    await appendRunHistory(nestedPath, makeEntry());
    expect(existsSync(nestedPath)).toBe(true);
  });
});

describe('readRunHistory', () => {
  it('returns empty array if file does not exist', async () => {
    const result = await readRunHistory(historyPath);
    expect(result).toEqual([]);
  });

  it('parses all entries from file', async () => {
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'completed' }));
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'failed' }));
    const result = await readRunHistory(historyPath);
    expect(result).toHaveLength(2);
  });

  it('skips corrupted lines (logs warn, does not throw)', async () => {
    writeFileSync(historyPath, [
      JSON.stringify(makeEntry()),
      '{ this is not valid JSON',
      JSON.stringify(makeEntry({ exit_reason: 'failed' })),
      '',
    ].join('\n'), 'utf-8');

    const result = await readRunHistory(historyPath);
    expect(result).toHaveLength(2);
    expect(result[0].exit_reason).toBe('completed');
    expect(result[1].exit_reason).toBe('failed');
  });

  it('filters by sinceDays', async () => {
    const now = Date.now();
    const oldEntry = makeEntry({
      started_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),  // 10 天前
    });
    const newEntry = makeEntry({
      started_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),   // 1 天前
    });
    await appendRunHistory(historyPath, oldEntry);
    await appendRunHistory(historyPath, newEntry);

    const result = await readRunHistory(historyPath, { sinceDays: 7 });
    expect(result).toHaveLength(1);
    expect(result[0].run_id).toBe(newEntry.run_id);
  });
});

describe('summaryStats', () => {
  it('returns zero counts for empty input', () => {
    const stats = summaryStats([]);
    expect(stats.totalRuns).toBe(0);
    expect(stats.failedRuns).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
  });

  it('computes totalRuns / failedRuns / avgDurationMs', () => {
    const entries = [
      makeEntry({ duration_ms: 100, exit_reason: 'completed' }),
      makeEntry({ duration_ms: 200, exit_reason: 'failed' }),
      makeEntry({ duration_ms: 300, exit_reason: 'completed' }),
    ];
    const stats = summaryStats(entries);
    expect(stats.totalRuns).toBe(3);
    expect(stats.failedRuns).toBe(1);
    expect(stats.avgDurationMs).toBe(200);
  });

  it('aggregates top 5 errors by normalized message', () => {
    const entries = [
      makeEntry({ errors: ['LLM timeout', 'rate_limited'] }),
      makeEntry({ errors: ['LLM timeout'] }),
      makeEntry({ errors: ['rate_limited'] }),
      makeEntry({ errors: ['rate_limited'] }),
      makeEntry({ errors: ['rate_limited'] }),
      makeEntry({ errors: ['unique error'] }),
    ];
    const stats = summaryStats(entries);
    expect(stats.topErrors[0].message).toBe('rate_limited');
    expect(stats.topErrors[0].count).toBe(4);
    expect(stats.topErrors[1].message).toBe('LLM timeout');
    expect(stats.topErrors[1].count).toBe(2);
  });
});
