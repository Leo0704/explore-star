/**
 * run-daily 落 cost_estimate 到 run_history.jsonl
 *
 * Phase 2 #4:验证 finally 块 entry 含 cost_estimate 字段(即使全 0)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelAdapter } from '../../src/core/types.js';

let tmpDir: string;
let originalCwd: string;
let historyPath: string;
let businessDir: string;

const stubChannel = {
  name: 'stub',
  rateLimits: {
    search_per_hour: 0, user_videos_per_hour: 0, comment_per_hour: 0,
    friend_request_per_day: 0, dm_per_day: 0,
  },
  async ping() { return { ok: true, loggedIn: true }; },
  async search() { return []; },
  async getUserVideos() { return []; },
  async getVideoComments() { return []; },
} as unknown as ChannelAdapter;

function setupBusiness(): void {
  businessDir = join(tmpDir, 'business');
  mkdirSync(join(businessDir, 'prompts'), { recursive: true });
  writeFileSync(
    join(businessDir, 'profile.yaml'),
    'business:\n  name: t\n  value_prop: v\ntarget_personas:\n  - id: p1\n    name: P1\n    description: d\n    typical_pain_points: []\nintent_signals: []\nbuying_stages: []\nllm: { provider: deepseek, model: m, api_key_env: X }\ncrm: { type: feishu, config: {} }\nhook_config: { style: s, max_length: 30, language: zh }\n',
  );
  writeFileSync(join(businessDir, 'prompts', 'intent-system.md'), '# sys');
  writeFileSync(join(businessDir, 'prompts', 'intent-user.md'), '{{#each comments}}{{cid}}\n{{/each}}');
  writeFileSync(join(businessDir, 'channels.yaml'), 'source: { mode: sec_uid }\n');
  writeFileSync(join(businessDir, 'conversion.yaml'), '');
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'run-daily-cost-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  historyPath = join(tmpDir, 'data', 'run_history.jsonl');
  setupBusiness();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runDaily 落 cost_estimate 到 run_history', () => {
  it('cost_estimate 字段在 entry 中存在(可全 0)', async () => {
    const { runDaily } = await import('../../src/orchestration/run-daily.js');
    await runDaily({
      businessDir,
      injectHistoryPath: historyPath,
      injectChannel: stubChannel,
      skipLLM: true,
      mode: 'read-only',
    }).catch(() => { /* 预期可能 throw */ });

    expect(existsSync(historyPath)).toBe(true);
    const content = readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry).toHaveProperty('cost_estimate');
    expect(entry.cost_estimate).toHaveProperty('prompt_tokens');
    expect(entry.cost_estimate).toHaveProperty('completion_tokens');
    expect(entry.cost_estimate).toHaveProperty('estimated_cost_usd');
    expect(entry.cost_estimate.prompt_tokens).toBe(0);
    expect(entry.cost_estimate.completion_tokens).toBe(0);
    expect(entry.cost_estimate.estimated_cost_usd).toBe(0);
  });

  it('cost_estimate 字段在失败路径也存在', async () => {
    const { runDaily } = await import('../../src/orchestration/run-daily.js');
    await runDaily({
      businessDir: '/nonexistent-business-for-cost-test',
      injectHistoryPath: historyPath,
      injectWriteHistory: true,
      skipLLM: true,
      mode: 'read-only',
    }).catch(() => { /* 预期 throw */ });

    expect(existsSync(historyPath)).toBe(true);
    const content = readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry.exit_reason).toBe('failed');
    expect(entry).toHaveProperty('cost_estimate');
    expect(entry.cost_estimate.prompt_tokens).toBe(0);
  });
});
