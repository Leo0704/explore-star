/**
 * run-daily 编排器测试 —— F1 修复验证
 *
 * 目标:runDaily 必须调 executeTasks (phase7b),并在 RunDailyResult 返回 tasksExecuted
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDaily } from '../../../src/orchestration/run-daily.js';

// 用 vi.hoisted 让 mock fn + path 在 vi.mock 工厂里也能拿到(vi.mock 被 hoist 到所有 import 之前)
const { executeTasksMock, MOCK_PATH } = vi.hoisted(() => {
  const path = new URL('../../src/modules/task-executor/index.ts', import.meta.url).pathname;
  return {
    executeTasksMock: vi.fn(),
    MOCK_PATH: path,
  };
});

vi.mock(MOCK_PATH, async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/modules/task-executor/index.js')>();
  return {
    ...actual,
    executeTasks: executeTasksMock,
  };
});

import type { ExecutionResult } from '../../../src/modules/task-executor/index.js';

describe('run-daily — F1: phase7b_executeTasks', () => {
  beforeEach(() => {
    executeTasksMock.mockReset();
    executeTasksMock.mockResolvedValue([] as ExecutionResult[]);
  });

  it('runDaily 应调 executeTasks 一次（dryRun=false 模式）', async () => {
    await runDaily({
      businessDir: './business.example/燃点-FDE',
      dryRun: false,
    });
    expect(executeTasksMock).toHaveBeenCalledTimes(1);
  });

  it('RunDailyResult.tasksExecuted 应反映 executeTasks 返回的 results 数量', async () => {
    const fakeResults: ExecutionResult[] = [
      {
        task_id: 'task-001',
        lead_cid: 'cid-001',
        action: 'like_and_follow',
        result: 'executed_with_response',
        executed_at: new Date().toISOString(),
      },
    ];
    executeTasksMock.mockResolvedValue(fakeResults);

    const result = await runDaily({
      businessDir: './business.example/燃点-FDE',
      dryRun: false,
    });

    expect(result.tasksExecuted).toBe(1);
  });

  it('dryRun=true 时 executeTasks 不应被调（保持向后兼容）', async () => {
    await runDaily({
      businessDir: './business.example/燃点-FDE',
      dryRun: true,
    });
    expect(executeTasksMock).not.toHaveBeenCalled();
  });
});
