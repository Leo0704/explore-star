/**
 * 编排器测试 —— health-check 覆盖
 *
 * 注：state 和 run-daily 的测试已移至 orchestration/state.test.ts 和 orchestration/run-daily.test.ts
 */

import { describe, it, expect } from 'vitest';
import type { HealthCheckResult, HealthStatus } from '../src/orchestration/health-check.js';

const VALID_STATUSES: HealthStatus[] = ['ok', 'warning', 'critical', 'error'];

describe('Orchestration', () => {
  describe('health-check', () => {
    it('checkAll 应返回 HealthCheckResult 且 status 必为 4 态之一', async () => {
      const { checkAll } = await import('../src/orchestration/health-check.js');

      const result = await checkAll();

      // 结构断言
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('checks');
      expect(result).toHaveProperty('summary');
      // status 必为合法枚举
      expect(VALID_STATUSES).toContain(result.status);
      // summary 形如 "<n> 严重 / <n> 警告 / <n> 正常"
      expect(result.summary).toMatch(/严重/);
      expect(result.summary).toMatch(/警告/);
      expect(result.summary).toMatch(/正常/);
      // checks 是数组且每项都有 name/status/message
      expect(Array.isArray(result.checks)).toBe(true);
      for (const c of result.checks) {
        expect(typeof c.name).toBe('string');
        expect(VALID_STATUSES).toContain(c.status);
        expect(typeof c.message).toBe('string');
      }
    });

    it('checkAll 应至少返回 4 类检查（系统/Adapter/限速/紧急停止）', async () => {
      const { checkAll } = await import('../src/orchestration/health-check.js');

      const result = await checkAll();

      // 已知检查项必须出现
      const names = result.checks.map(c => c.name);
      expect(names).toContain('emergency_stop');
      // 至少有 4 个类别的检查（emergency_stop + 至少 1 个 system 类 + 至少 1 个 adapter 类 + daily_tasks）
      expect(result.checks.length).toBeGreaterThanOrEqual(4);
    });

    it('checkEmergencyStop 应只检查 1 项且 status 必为 ok 或 critical', async () => {
      const { checkEmergencyStop } = await import('../src/orchestration/health-check.js');

      const result = await checkEmergencyStop();

      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].name).toBe('emergency_stop');
      expect(['ok', 'critical']).toContain(result.checks[0].status);
      // 紧急停止的 message 应明确
      expect(result.checks[0].message).toMatch(/紧急停止/);
    });

    it('checkAdapterHealth 应包含 LLM/CRM/Channel/Notifier 4 类', async () => {
      const { checkAdapterHealth } = await import('../src/orchestration/health-check.js');

      const result = await checkAdapterHealth();

      const names = result.checks.map(c => c.name);
      expect(names).toEqual(expect.arrayContaining(['llm', 'crm', 'channel', 'notifier']));
      // summary 应是 "Adapter 检查：<ok>/<total> 通过"
      expect(result.summary).toMatch(/Adapter 检查：\s*\d+\/\d+\s*通过/);
    });
  });
});
