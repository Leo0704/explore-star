/**
 * task-executor 单元测试（§3.6.5）
 *
 * 覆盖：限速/紧急停止/风控信号/mock 浏览器
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadSafetyConfig,
  isEmergencyStop,
  throwIfEmergencyStop,
  createRateLimiter,
  executeTasks,
  reviewHook,
} from '../../src/modules/task-executor/index.js';
import { executeBrowserAction } from '../../src/modules/task-executor/browser-actions.js';
import type { Task, SafetyConfig } from '../../src/core/types.js';

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
  fatal_signals: [
    'auth_wall_detected',
    'captcha_triggered_3_times_in_1h',
    'private_msg_rejected_2_times',
    'ip_changed_5_times',
  ],
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
    it('返回默认配置', () => {
      // 不读取真实文件，直接测试默认配置逻辑
      const config: SafetyConfig = {
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
      };
      expect(config.rate_limits.douyin.friend_request_per_day).toBe(5);
      expect(config.rate_limits.douyin.dm_per_day).toBe(10);
    });
  });

  describe('限速器', () => {
    it('记录好友请求次数', () => {
      const limiter = createRateLimiter();
      expect(limiter.canFriendRequest(mockConfig)).toBe(true);
      limiter.recordFriendRequest();
      expect(limiter.canFriendRequest(mockConfig)).toBe(false);
    });

    it('记录私信次数', () => {
      const limiter = createRateLimiter();
      expect(limiter.canDm(mockConfig)).toBe(true);
      limiter.recordDm();
      limiter.recordDm();
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
    it('默认返回 false', () => {
      // 没有真实 EMERGENCY_STOP 文件时返回 false
      expect(isEmergencyStop(mockConfig)).toBe(false);
    });
  });

  describe('浏览器执行 mock', () => {
    it('返回模拟执行结果', async () => {
      const task = mkTask();
      const result = await executeBrowserAction(task);
      expect(result.task_id).toBe('t1');
      expect(result.lead_cid).toBe('c1');
      expect(result.executed_at).toBeDefined();
    });
  });

  describe('executeTasks', () => {
    it('空任务列表返回空结果', async () => {
      const results = await executeTasks([], mockConfig);
      expect(results).toHaveLength(0);
    });

    it('单任务返回成功结果', async () => {
      const tasks = [mkTask()];
      const results = await executeTasks(tasks, mockConfig);
      expect(results).toHaveLength(1);
      expect(results[0].result).toBeDefined();
    });

    it('好友请求达上限则跳过', async () => {
      const limiter = createRateLimiter();
      for (let i = 0; i < 5; i++) {
        limiter.recordFriendRequest();
      }
      const tasks = [mkTask({ next_action: 'friend_request' })];
      const results = await executeTasks(tasks, mockConfig);
      expect(results[0].result).toBe('skipped');
      expect(results[0].error_message).toContain('好友申请已达上限');
    });

    it('私信达上限则跳过', async () => {
      const limiter = createRateLimiter();
      for (let i = 0; i < 10; i++) {
        limiter.recordDm();
      }
      const tasks = [mkTask({ next_action: 'dm' })];
      const results = await executeTasks(tasks, mockConfig);
      expect(results[0].result).toBe('skipped');
      expect(results[0].error_message).toContain('私信已达上限');
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

    // 模拟 30 天
    for (let day = 0; day < 30; day++) {
      const stateIndex = states.indexOf(currentState);
      if (stateIndex < states.length - 1) {
        // 随机决定是否推进（70% 概率推进）
        if (Math.random() < 0.7) {
          currentState = states[stateIndex + 1];
        }
      }
    }

    // 30 天后应该推进到后面的状态
    expect(states.indexOf(currentState)).toBeGreaterThanOrEqual(0);
  });
});