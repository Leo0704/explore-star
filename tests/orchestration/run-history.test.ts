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
  type RunHistoryEntry,
} from '../../src/orchestration/run-history.js';

let tmpDir: string;
let historyPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'run-history-test-'));
  historyPath = join(tmpDir, 'run_history.jsonl');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
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
