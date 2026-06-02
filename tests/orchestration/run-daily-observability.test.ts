/**
 * run-daily.ts 观测性接线测试
 *
 * Phase 0 PR 1：验证 run_history 在成功路径必落盘（finally 块语义）
 * Phase 0 PR 2（Task 2.2）：失败路径 + notifier 告警
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelAdapter, Notifier } from '../../src/core/types.js';

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

// ---------------------------------------------------------------------------
// Phase 0 PR 2（Task 2.2）：失败路径 notifier 告警
// ---------------------------------------------------------------------------

function makeTestNotifier(): Notifier & { send: ReturnType<typeof vi.fn> } {
  return {
    name: 'test',
    send: vi.fn().mockResolvedValue({ ok: true, message_id: 'test-1' }),
  };
}

describe('runDaily fires notifier on failure', () => {
  it('sends critical alert on LoginRequiredError', async () => {
    // 触发 LoginRequiredError catch 路径：
    //   channel.ping() 返回 loggedIn=false → assertLoggedIn 抛 LoginRequiredError
    //   外层 catch 立即发 critical 告警（不等 finally）
    const testNotifier = makeTestNotifier();
    const { runDaily, LoginRequiredError } = await import('../../src/orchestration/run-daily.js');

    // 注入一个返回 loggedIn=false 的 channel
    const errorChannel = {
      name: 'error-stub',
      rateLimits: {
        search_per_hour: 0, user_videos_per_hour: 0, comment_per_hour: 0,
        friend_request_per_day: 0, dm_per_day: 0,
      },
      async ping() { return { ok: true, loggedIn: false }; },
      async search() { return []; },
      async getUserVideos() { return []; },
      async getVideoComments() { return []; },
    } as unknown as ChannelAdapter;

    // 业务目录存在（避免 loadBusinessProfile 抛错把 LoginRequiredError 路径覆盖），
    // 但我们实际上在 ping 阶段就抛，所以业务目录不需要真的有效——但 loadBusinessProfile
    // 是在 ping 之前调用的，所以我们用一个不存在的目录也能到 ping 抛错。
    // 不过 plan 说要测试 LoginRequiredError 路径，所以必须让它过 profile 加载。
    // 折中：让 loadBusinessProfile 抛（businessDir 不存在），但通过 channel.ping 提前抛
    // 不可达。改方案：用一个真实的业务目录路径——但 tmpDir 已经被 chdir 了。
    //
    // 简化路径：直接验证 catch+finally 块对 notifier.send 的调用，不强求 LoginRequiredError。
    // 业务失败（非 login_required）也会走 finally 的 warning 告警。
    // 但 plan 要求 critical — 所以必须触发 LoginRequiredError。
    //
    // 最终方案：mock 掉 loadBusinessProfile 不可能（动态 import），改用 injectNotifiers
    // 直接观察 LoginRequiredError 触发的 critical 调用。
    // 关键：业务失败（非 login）走 finally → warning；LoginRequiredError 走 catch → critical
    // 我们的 errorChannel 会在 ping() 阶段抛 LoginRequiredError——前提是 loadBusinessProfile 通过。
    //
    // 为让 loadBusinessProfile 通过，我们必须传一个有效 businessDir。
    // 借用 stubChannel 让"已登录"通过，但本 case 要 LoginRequiredError 路径。
    // → 创建一个含 profile.yaml 的临时业务目录。

    const { mkdirSync, writeFileSync } = await import('node:fs');
    const bizDir = join(tmpDir, 'biz-lr');
    mkdirSync(bizDir, { recursive: true });
    writeFileSync(join(bizDir, 'profile.yaml'), [
      'business:',
      '  name: "Test Biz"',
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

    try {
      await runDaily({
        businessDir: bizDir,
        injectChannel: errorChannel,
        injectNotifiers: [testNotifier],
        injectHistoryPath: historyPath,
        injectWriteHistory: true,
        skipLLM: true,
        mode: 'read-only',
      });
    } catch (e) {
      // 预期 throw LoginRequiredError
      expect(e).toBeInstanceOf(LoginRequiredError);
    }

    // 验证 critical 告警
    expect(testNotifier.send).toHaveBeenCalled();
    const calls = testNotifier.send.mock.calls;
    const criticalCall = calls.find(c => c[0].level === 'critical');
    expect(criticalCall).toBeDefined();
    expect(criticalCall![0].body).toMatch(/login/i);
  });

  it('sends warning alert on generic business failure (non-login)', async () => {
    // 业务目录不存在 → loadBusinessProfile 抛普通错（非 LoginRequiredError）
    //   → catch 走 exitReason='failed' 分支
    //   → finally 末尾发 warning 告警
    const testNotifier = makeTestNotifier();
    const { runDaily } = await import('../../src/orchestration/run-daily.js');

    try {
      await runDaily({
        businessDir: '/nonexistent-for-fail-test',
        injectChannel: stubChannel,
        injectNotifiers: [testNotifier],
        injectHistoryPath: historyPath,
        injectWriteHistory: true,
        skipLLM: true,
        mode: 'read-only',
      });
    } catch {
      // 预期 throw
    }

    expect(testNotifier.send).toHaveBeenCalled();
    const calls = testNotifier.send.mock.calls;
    const warnCall = calls.find(c => c[0].level === 'warning');
    expect(warnCall).toBeDefined();
    expect(warnCall![0].body).toMatch(/失败/);
  });
});
