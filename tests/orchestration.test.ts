/**
 * 编排器测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HealthCheckResult, HealthStatus, PipelineState } from '../src/orchestration/health-check.js';

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

  describe('state', () => {
    it('resetForNewDay 应返回 date=今天 + 7 个 step + completed=false', async () => {
      const { resetForNewDay } = await import('../src/orchestration/state.js');

      const state = await resetForNewDay();

      // date 形如 YYYY-MM-DD == 今天
      const today = new Date().toISOString().slice(0, 10);
      expect(state.date).toBe(today);
      // 必有 7 个 step
      expect(state.steps).toHaveLength(7);
      // 当前 step 0
      expect(state.currentStep).toBe(0);
      // 7 个 step name 必为已知值
      const expectedNames = [
        'reconnaissance', 'analysis', 'sync', 'task_generation',
        'execution', 'notification', 'health_check',
      ];
      expect(state.steps.map(s => s.name)).toEqual(expectedNames);
      // 所有 step 应为 pending
      for (const s of state.steps) {
        expect(s.status).toBe('pending');
      }
      // 全部完成标记为 false
      expect(state.completed).toBe(false);
    });

    it('loadState 应返回与 resetForNewDay 形状一致的对象', async () => {
      const { loadState, resetForNewDay } = await import('../src/orchestration/state.js');

      await resetForNewDay();
      const state = await loadState();

      expect(state.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(state.steps).toHaveLength(7);
      expect(state).toHaveProperty('startedAt');
      expect(state).toHaveProperty('lastUpdatedAt');
      expect(state).toHaveProperty('errors');
      expect(Array.isArray(state.errors)).toBe(true);
    });

    it('updateStep 应把指定 step 改为给定状态并 currentStep 推进', async () => {
      const { updateStep, resetForNewDay } = await import('../src/orchestration/state.js');

      await resetForNewDay();
      const state = await updateStep(0, 'completed', { test: true });

      // 第 0 个 step 应为 completed
      expect(state.steps[0].status).toBe('completed');
      // currentStep 应推进到 1
      expect(state.currentStep).toBe(1);
      // result 应被写入
      expect(state.steps[0].result).toEqual({ test: true });
      // completedAt 应被写入
      expect(typeof state.steps[0].completedAt).toBe('string');
      // 其它 step 仍为 pending
      for (let i = 1; i < state.steps.length; i++) {
        expect(state.steps[i].status).toBe('pending');
      }
    });

    it('persist state atomically via tmp+rename', async () => {
      const { saveState, loadState, resetForNewDay } = await import('../src/orchestration/state.js');
      const { rm, writeFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');

      // isolate to a temp state file
      const origFile = './data/state.json';
      const bakFile = './data/state.json.bak.atomic-test';
      if (existsSync(origFile)) {
        const { copyFile } = await import('node:fs/promises');
        await copyFile(origFile, bakFile);
      }

      try {
        await resetForNewDay();
        const before = await loadState();
        before.steps[0].status = 'completed';
        before.steps[0].result = { atomic: true };
        await saveState(before);

        // confirm final file is valid JSON and matches what was written
        const after = await loadState();
        expect(after.steps[0].status).toBe('completed');
        expect(after.steps[0].result).toEqual({ atomic: true });
        // 原子写不应残留 .tmp.<pid> 文件
        const { readdirSync } = await import('node:fs');
        const tmpFiles = readdirSync('./data').filter(f => f.includes('.tmp.'));
        expect(tmpFiles).toEqual([]);
      } finally {
        // restore original state
        try {
          const { cp } = await import('node:fs/promises');
          if (existsSync(bakFile)) {
            await cp(bakFile, origFile);
            await rm(bakFile);
          } else if (existsSync(origFile)) {
            await rm(origFile);
          }
        } catch { /* best-effort */ }
      }
    });
  });

  describe('run-daily', () => {
    it('dry-run 模式应 resolve 且不抛错', async () => {
      const { runDaily } = await import('../src/orchestration/run-daily.js');

      // dry-run 不写真实数据
      const result = await runDaily({
        businessDir: './business.example/燃点-FDE',
        dryRun: true,
      });

      // 至少返回可识别的对象
      expect(result).toBeDefined();
    });
  });
});
