/**
 * 编排器测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Orchestration', () => {
  describe('health-check', () => {
    it('should run all health checks', async () => {
      const { checkAll } = await import('../src/orchestration/health-check.js');

      const result = await checkAll();

      expect(result.checks.length).toBeGreaterThan(0);
      expect(['ok', 'warning', 'critical', 'error']).toContain(result.status);
    });

    it('should check emergency stop', async () => {
      const { checkEmergencyStop } = await import('../src/orchestration/health-check.js');

      const result = await checkEmergencyStop();

      expect(result.checks.length).toBeGreaterThan(0);
    });

    it('should check adapter health', async () => {
      const { checkAdapterHealth } = await import('../src/orchestration/health-check.js');

      const result = await checkAdapterHealth();

      expect(result.checks.length).toBeGreaterThan(0);
    });
  });

  describe('state', () => {
    it('should create new state', async () => {
      const { loadState, resetForNewDay } = await import('../src/orchestration/state.js');

      const state = await resetForNewDay();

      expect(state.date).toBe(new Date().toISOString().slice(0, 10));
      expect(state.steps.length).toBe(7);
      expect(state.completed).toBe(false);
    });

    it('should load existing state', async () => {
      const { loadState, saveState, resetForNewDay } = await import('../src/orchestration/state.js');

      await resetForNewDay();
      const state = await loadState();

      expect(state).toBeDefined();
      expect(state.steps).toBeDefined();
    });

    it('should update step', async () => {
      const { updateStep, resetForNewDay } = await import('../src/orchestration/state.js');

      await resetForNewDay();
      const state = await updateStep(0, 'completed', { test: true });

      expect(state.steps[0].status).toBe('completed');
    });

    it('should get resume point', async () => {
      const { getResumePoint, resetForNewDay } = await import('../src/orchestration/state.js');

      await resetForNewDay();
      const resumePoint = await getResumePoint();

      expect(resumePoint).toBeDefined();
      expect(resumePoint?.step).toBe(0);
    });
  });

  describe('run-daily', () => {
    it('should accept dry-run mode', async () => {
      // Dry run should not throw even without full setup
      const { runDaily } = await import('../src/orchestration/run-daily.js');

      // This will fail without proper setup but should not crash
      await expect(runDaily({
        businessDir: './business.example/燃点-FDE',
        dryRun: true,
      })).resolves.toBeDefined();
    });
  });
});