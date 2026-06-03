/**
 * run-daily.ts — Bug 18: execution step state machine 验证
 *
 * Bug 18：run-daily.ts 的 execution 块（step 4）从未调用 updateStep，
 *         导致 state.json 里 steps[4] 永远是 'pending'（state machine 在撒谎）。
 *
 * 修复期望：execution 块开始时 updateStep(4, 'running')，结束时
 *          updateStep(4, 'completed', { executed } | { skipped: true })。
 *
 * 测试策略：
 *   - 注入 stub channel + stub executeTasks（read-only 模式避开真实执行）
 *   - 跑一次 runDaily
 *   - 读 data/state.json，断言 steps[4].status !== 'pending'
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ChannelAdapter } from '../../src/core/types.js';

let tmpDir: string;
let originalCwd: string;

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
  tmpDir = mkdtempSync(join(tmpdir(), 'run-daily-step4-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  // 建一个最小业务目录，让 loadBusinessProfile 通过
  const bizDir = join(tmpDir, 'biz');
  mkdirSync(bizDir, { recursive: true });
  writeFileSync(join(bizDir, 'profile.yaml'), [
    'business:',
    '  name: "Step4 Test Biz"',
    '  value_prop: "Test"',
    'target_personas:',
    '  - id: p1',
    '    name: TestPersona',
    '    typical_pain_points: ["pain1"]',
    'intent_signals:',
    '  - "kw1"',
    'llm:',
    '  provider: openai',
    '  model: gpt-4o-mini',
    '  api_key_env: OPENAI_API_KEY',
    'crm:',
    '  type: csv',
    '  config:',
    '    path: "./data/leads.csv"',
  ].join('\n'));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('run-daily — Bug 18: execution step (index 4) must update state', () => {
  it('after a successful run, state.steps[4].status is not "pending"', async () => {
    const { runDaily } = await import('../../src/orchestration/run-daily.js');

    // 注入一个标记 executeTasks 是否被调的 stub
    const execMarker = { called: false };
    const stubExec: typeof import('../../src/modules/task-executor/index.js').executeTasks = (async () => {
      execMarker.called = true;
      return [];
    }) as never;

    // mode='read-only' → 不会调 executeTasks 也不需要真浏览器，但 execution 块应仍被标记
    await runDaily({
      businessDir: join(tmpDir, 'biz'),
      injectChannel: stubChannel,
      injectExecuteTasks: stubExec,
      injectHistoryPath: join(tmpDir, 'history.jsonl'),
      injectWriteHistory: false,
      skipLLM: true,
      mode: 'read-only',  // 关键：read-only 模式让 execution 块"被进入但跳过实际执行"
    });

    // 读 state.json
    const statePath = './data/state.json';
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.steps).toHaveLength(7);

    // 关键断言：step 4 (execution) 不应再是 pending
    const executionStep = state.steps[4];
    expect(executionStep.name).toBe('execution');
    expect(executionStep.status).not.toBe('pending');
    // 至少应该是 completed（哪怕 skipped 也要 completed）
    expect(['completed', 'failed']).toContain(executionStep.status);
  });
});
