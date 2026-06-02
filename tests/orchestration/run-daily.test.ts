/**
 * run-daily 编排器测试 —— phase7b executeTasks 验证
 *
 * 直接用真实环境（浏览器已搭建），不 mock。
 */

import { describe, it, expect } from 'vitest';
import { runDaily } from '../../src/orchestration/run-daily.js';

// R1：注入 mock channel，避免测试环境无登录态导致 assertLoggedIn 抛 LoginRequiredError
const mockChannel = {
  name: 'mock',
  rateLimits: { search_per_hour: 0, user_videos_per_hour: 0, comment_per_hour: 0, friend_request_per_day: 0, dm_per_day: 0 },
  async ping() { return { ok: true, loggedIn: true }; },
  async search() { return []; },
  async getUserVideos() { return []; },
};

describe('run-daily — phase7b: executeTasks', () => {
  it('dryRun=true 时 executeTasks 不应被调，tasksExecuted=0', async () => {
    const result = await runDaily({
      businessDir: './business.example/燃点-FDE',
      dryRun: true,
      injectChannel: mockChannel as any,
    });
    expect(result.tasksExecuted).toBe(0);
  });

  it('dryRun=false 应走完全流程（含 phase7b）不抛异常', async () => {
    const result = await runDaily({
      businessDir: './business.example/燃点-FDE',
      dryRun: false,
      injectChannel: mockChannel as any,
    });
    // 应有 date 和 duration
    expect(result.date).toBeTruthy();
    expect(result.duration_ms).toBeGreaterThan(0);
    // tasksExecuted 应有值（0 或正数，取决于 CRM 中是否有待执行任务）
    expect(typeof result.tasksExecuted).toBe('number');
  });

  it('mode=read-only 应跳过 phase 7b 任务执行', async () => {
    // 用 injectExecuteTasks 验证：若被调，测试会拿到我们的标记
    const callMarker = { called: false };
    const stubExec: any = async () => {
      callMarker.called = true;
      return [];
    };

    const result = await runDaily({
      businessDir: './business.example/燃点-FDE',
      dryRun: false,
      mode: 'read-only',
      injectChannel: mockChannel as any,
      injectExecuteTasks: stubExec,
    });

    // executeTasks 不应被调 → tasksExecuted 必为 0
    expect(callMarker.called).toBe(false);
    expect(result.tasksExecuted).toBe(0);
  });
});
