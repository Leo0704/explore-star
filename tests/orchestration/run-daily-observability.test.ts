/**
 * run-daily.ts 观测性接线测试
 *
 * Phase 0 PR 1：验证 run_history 在成功路径必落盘（finally 块语义）
 * Phase 0 PR 2（Task 2.2）：失败路径 + notifier 告警
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelAdapter } from '../../src/core/types.js';

let tmpDir: string;
let originalCwd: string;
let historyPath: string;

// 测试用 stub channel —— 关键：loginSession 永远不抛（避开 LoginRequiredError 路径，专注 finally 块）
const stubChannel = {
  name: 'stub',
  rateLimits: {
    search_per_hour: 0,
    user_videos_per_hour: 0,
    comment_per_hour: 0,
    friend_request_per_day: 0,
    dm_per_day: 0,
  },
  async ping() { return { ok: true, loggedIn: true }; },
  async search() { return []; },
  async getUserVideos() { return []; },
  async getVideoComments() { return []; },
} as unknown as ChannelAdapter;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'run-daily-obs-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  historyPath = join(tmpDir, 'data', 'run_history.jsonl');
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runDaily writes run_history on success path (finally 块语义)', () => {
  it('appends exactly one entry per run, even if business fails mid-pipeline', async () => {
    const { runDaily } = await import('../../src/orchestration/run-daily.js');

    // 业务目录不存在 → loadBusinessProfile 抛 → runDaily 走 catch → finally 落 history
    await runDaily({
      businessDir: '/nonexistent-for-test',
      injectHistoryPath: historyPath,
      injectWriteHistory: true,
      skipLLM: true,
      mode: 'read-only',
    }).catch(() => { /* 预期 throw */ });

    // finally 块保证 history 必落
    expect(existsSync(historyPath)).toBe(true);
    const content = readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.business).toBe('/nonexistent-for-test');
    expect(entry.mode).toBe('read-only');
    expect(entry.exit_reason).toBe('failed');  // 业务失败 → exit_reason='failed'
  });
});
