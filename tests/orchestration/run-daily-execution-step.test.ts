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

    const execMarker = { called: false };
    const stubExec: typeof import('../../src/modules/task-executor/index.js').executeTasks = (async () => {
      execMarker.called = true;
      return [];
    }) as never;

    await runDaily({
      businessDir: join(tmpDir, 'biz'),
      injectChannel: stubChannel,
      injectExecuteTasks: stubExec,
      injectHistoryPath: join(tmpDir, 'history.jsonl'),
      injectWriteHistory: false,
      skipLLM: true,
      mode: 'read-only',
    });

    const statePath = './data/state.json';
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.steps).toHaveLength(7);

    const executionStep = state.steps[4];
    expect(executionStep.name).toBe('execution');
    expect(executionStep.status).not.toBe('pending');
    expect(['completed', 'failed']).toContain(executionStep.status);
  });
});
