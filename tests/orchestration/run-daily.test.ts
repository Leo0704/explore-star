/**
 * run-daily 编排器测试 —— phase7b executeTasks 验证
 *
 * 直接用真实环境（浏览器已搭建），不 mock。
 */

import { describe, it, expect } from 'vitest';
import { runDaily } from '../../src/orchestration/run-daily.js';

describe('run-daily — phase7b: executeTasks', () => {
  it('dryRun=true 时 executeTasks 不应被调，tasksExecuted=0', async () => {
    const result = await runDaily({
      businessDir: './business.example/燃点-FDE',
      dryRun: true,
    });
    expect(result.tasksExecuted).toBe(0);
  });

  it('dryRun=false 应走完全流程（含 phase7b）不抛异常', async () => {
    const result = await runDaily({
      businessDir: './business.example/燃点-FDE',
      dryRun: false,
    });
    // 应有 date 和 duration
    expect(result.date).toBeTruthy();
    expect(result.duration_ms).toBeGreaterThan(0);
    // tasksExecuted 应有值（0 或正数，取决于 CRM 中是否有待执行任务）
    expect(typeof result.tasksExecuted).toBe('number');
  });
});
