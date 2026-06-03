import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelAdapter, Notifier } from '../../src/core/types.js';

let tmpDir: string;
let originalCwd: string;
let historyPath: string;

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

    await runDaily({
      businessDir: '/nonexistent-for-test',
      injectHistoryPath: historyPath,
      injectWriteHistory: true,
      skipLLM: true,
      mode: 'read-only',
    }).catch(() => { });

    expect(existsSync(historyPath)).toBe(true);
    const content = readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.business).toBe('/nonexistent-for-test');
    expect(entry.mode).toBe('read-only');
    expect(entry.exit_reason).toBe('failed');
  });
});

function makeTestNotifier(): Notifier & { send: ReturnType<typeof vi.fn> } {
  return {
    name: 'test',
    send: vi.fn().mockResolvedValue({ ok: true, message_id: 'test-1' }),
  };
}

describe('runDaily fires notifier on failure', () => {
  it('sends critical alert on LoginRequiredError', async () => {
    const testNotifier = makeTestNotifier();
    const { runDaily, LoginRequiredError } = await import('../../src/orchestration/run-daily.js');

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
      expect(e).toBeInstanceOf(LoginRequiredError);
    }

    expect(testNotifier.send).toHaveBeenCalled();
    const calls = testNotifier.send.mock.calls;
    const criticalCall = calls.find(c => c[0].level === 'critical');
    expect(criticalCall).toBeDefined();
    expect(criticalCall![0].body).toMatch(/login/i);
  });

  it('sends warning alert on generic business failure (non-login)', async () => {
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
    }

    expect(testNotifier.send).toHaveBeenCalled();
    const calls = testNotifier.send.mock.calls;
    const warnCall = calls.find(c => c[0].level === 'warning');
    expect(warnCall).toBeDefined();
    expect(warnCall![0].body).toMatch(/失败/);
  });
});
