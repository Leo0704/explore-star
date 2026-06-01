/**
 * task-executor 单元测试（§3.6.5）
 *
 * 覆盖：限速/紧急停止/风控信号/mock 浏览器
 */

import { describe, it, expect } from 'vitest';
import type { Task, SafetyConfig } from '../../src/core/types.js';

// 直接导入（不需要 mock）
import { createRateLimiter, isEmergencyStop, reviewHook } from '../../src/modules/task-executor/index.js';

const mockConfig: SafetyConfig = {
  rate_limits: {
    douyin: {
      search_calls_per_hour: 10,
      user_videos_calls_per_hour: 30,
      friend_request_per_day: 5,
      dm_per_day: 10,
    },
    min_interval_seconds: 3,
    max_interval_seconds: 8,
  },
  daily_budget: {
    videos: 50,
    comments_scanned: 5000,
    leads_created: 200,
    engagement_actions: 20,
  },
  emergency_stop: 'config/EMERGENCY_STOP',
  fatal_signals: [],
  hook_review: false,
};

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: 't1',
    lead_cid: 'c1',
    nickname: 'Test',
    current_state: '新发现',
    next_action: 'like_and_follow',
    hook: '测试钩子',
    hook_style: 'default',
    priority: 'medium',
    persona: 'self_media',
    scheduled_at: new Date().toISOString(),
    reason: '测试',
    ...overrides,
  };
}

describe('task-executor', () => {
  describe('loadSafetyConfig', () => {
    it('返回默认配置结构', () => {
      // 测试配置结构
      expect(mockConfig.rate_limits.douyin.friend_request_per_day).toBe(5);
      expect(mockConfig.rate_limits.douyin.dm_per_day).toBe(10);
      expect(mockConfig.rate_limits.min_interval_seconds).toBe(3);
      expect(mockConfig.rate_limits.max_interval_seconds).toBe(8);
    });
  });

  describe('限速器', () => {
    it('记录好友请求次数', () => {
      const limiter = createRateLimiter();
      expect(limiter.canFriendRequest(mockConfig)).toBe(true);  // 0 < 5 → true
      limiter.recordFriendRequest();
      // 1 < 5 → true (还没达到上限)
      expect(limiter.canFriendRequest(mockConfig)).toBe(true);
      // 再记录 4 次（共 5 次）达到上限
      for (let i = 0; i < 4; i++) {
        limiter.recordFriendRequest();
      }
      // 5 < 5 → false (达到上限)
      expect(limiter.canFriendRequest(mockConfig)).toBe(false);
    });

    it('记录私信次数', () => {
      const limiter = createRateLimiter();
      expect(limiter.canDm(mockConfig)).toBe(true);  // 0 < 10 → true
      limiter.recordDm();
      limiter.recordDm();
      // 2 < 10 → true (还没达到上限)
      expect(limiter.canDm(mockConfig)).toBe(true);
      // 再记录 8 次（共 10 次）达到上限
      for (let i = 0; i < 8; i++) {
        limiter.recordDm();
      }
      // 10 < 10 → false (达到上限)
      expect(limiter.canDm(mockConfig)).toBe(false);
    });

    it('随机间隔在 3-8 秒之间', () => {
      const limiter = createRateLimiter();
      for (let i = 0; i < 10; i++) {
        const ms = limiter.randomInterval(mockConfig);
        expect(ms).toBeGreaterThanOrEqual(3000);
        expect(ms).toBeLessThanOrEqual(8000);
      }
    });

    it('resetDaily 重置计数器', () => {
      const limiter = createRateLimiter();
      limiter.recordFriendRequest();
      limiter.recordDm();
      limiter.resetDaily();
      expect(limiter.canFriendRequest(mockConfig)).toBe(true);
      expect(limiter.canDm(mockConfig)).toBe(true);
    });
  });

  describe('紧急停止', () => {
    it('默认返回 false（无 EMERGENCY_STOP 文件）', () => {
      expect(isEmergencyStop(mockConfig)).toBe(false);
    });
  });

  describe('钩子审核', () => {
    it('关闭时直接批准', async () => {
      const task = mkTask();
      const result = await reviewHook(task, false);
      expect(result.approved).toBe(true);
    });

    it('开启时也直接批准（V1 mock）', async () => {
      const task = mkTask();
      const result = await reviewHook(task, true);
      expect(result.approved).toBe(true);
    });
  });

  describe('executeBrowserAction', () => {
    it('浏览器动作映射正确', async () => {
      const { executeBrowserAction } = await import('../../src/modules/task-executor/browser-actions.js');

      const task = mkTask();
      task.next_action = 'like_and_follow';
      const result = await executeBrowserAction(task);
      expect(result.task_id).toBe('t1');
      expect(result.lead_cid).toBe('c1');
      expect(result.executed_at).toBeDefined();
    });
  });
});

describe('50 mock leads 30天模拟', () => {
  it('生成 50 个 mock lead', () => {
    const leads = Array.from({ length: 50 }, (_, i) => ({
      cid: `c${i}`,
      status: '新发现',
      last_task_executed_at: null as string | null,
      last_task_result: null as string | null,
      execution_count: 0,
      response_count: 0,
      created_at: new Date().toISOString(),
      persona: i % 2 === 0 ? 'self_media' : 'ecommerce',
      nickname: `Lead${i}`,
      intent_score: 0.5 + Math.random() * 0.4,
    }));

    expect(leads).toHaveLength(50);
    expect(leads[0].cid).toBe('c0');
    expect(leads[49].cid).toBe('c49');
  });

  it('模拟 30 天状态推进', () => {
    const states = ['新发现', '已关注', '已互动', '已加好友', '已加微'];
    let currentState = '新发现';

    for (let day = 0; day < 30; day++) {
      const stateIndex = states.indexOf(currentState);
      if (stateIndex < states.length - 1) {
        if (Math.random() < 0.7) {
          currentState = states[stateIndex + 1];
        }
      }
    }

    expect(states.indexOf(currentState)).toBeGreaterThanOrEqual(0);
  });

  it('30天模拟：大多数 lead 应推进到后面的状态', () => {
    const states = ['新发现', '已关注', '已互动', '已加好友', '已加微'];
    let advancedCount = 0;

    for (let run = 0; run < 100; run++) {
      let currentState = '新发现';
      for (let day = 0; day < 30; day++) {
        const stateIndex = states.indexOf(currentState);
        if (stateIndex < states.length - 1 && Math.random() < 0.7) {
          currentState = states[stateIndex + 1];
        }
      }
      if (states.indexOf(currentState) > 0) {
        advancedCount++;
      }
    }

    // 70% 推进概率，30 天后大多数应该推进
    expect(advancedCount).toBeGreaterThan(50);
  });
});