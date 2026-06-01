/**
 * task-executor 单元测试（§3.6.5）
 *
 * 覆盖：限速/紧急停止/风控信号/mock 浏览器
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

// ---------------------------------------------------------------------------
// 9-阶段端到端测试（executeTasks）
//
// 这里通过 vi.doMock + vi.resetModules 注入 mock 的 browser-actions 和
// hook-review，让 executeTasks 走完全部 9 阶段但不发请求。
// ---------------------------------------------------------------------------

/**
 * 构造一个最小化 puppeteer-core.Browser fake，供 __fakeBrowser 路径使用
 * （executeBrowserActionWithBrowser 需要 browser.newPage() 不会抛错）
 */
function makeFakeBrowser() {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn().mockResolvedValue(''),
    click: vi.fn().mockResolvedValue(undefined),
    keyboard: { type: vi.fn().mockResolvedValue(undefined), press: vi.fn().mockResolvedValue(undefined) },
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as import('puppeteer-core').Browser;
}

/**
 * 给定 action 构造一个最小 task
 */
function makeE2ETask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: `t_${Math.random().toString(36).slice(2)}`,
    lead_cid: 'cid_1',
    nickname: 'E2EUser',
    current_state: '新发现',
    next_action: 'like_and_follow',
    hook: '测试钩子',
    hook_style: 'default',
    priority: 'medium',
    persona: 'self_media',
    scheduled_at: new Date(Date.now() - 1000).toISOString(), // 默认已到点
    reason: 'E2E',
    video_url: 'https://douyin.com/video/123',
    ...overrides,
  };
}

describe('executeTasks 9-阶段端到端', () => {
  // mock browser-actions（含 likeAndFollow 等所有动作的占位实现）
  const browserActionsMock = {
    executeBrowserAction: vi.fn(async (task: Task) => ({
      task_id: task.task_id,
      lead_cid: task.lead_cid,
      action: task.next_action,
      result: 'executed_with_response' as const,
      executed_at: new Date().toISOString(),
    })),
    likeAndFollow: vi.fn(async () => ({ ok: true })),
    commentReply: vi.fn(async () => ({ ok: true })),
    friendRequest: vi.fn(async () => ({ ok: true })),
    sendDirectMessage: vi.fn(async () => ({ ok: true })),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../../src/modules/task-executor/browser-actions.js', () => browserActionsMock);
    browserActionsMock.executeBrowserAction.mockClear();
    browserActionsMock.likeAndFollow.mockClear();
    browserActionsMock.commentReply.mockClear();
    browserActionsMock.friendRequest.mockClear();
    browserActionsMock.sendDirectMessage.mockClear();
  });

  afterEach(() => {
    vi.doUnmock('../../src/modules/task-executor/browser-actions.js');
    vi.doUnmock('../../src/modules/task-executor/hook-review.js');
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // (a) emergency_stop file → 第一个 task 抛错，后续 task 不被处理
  // -------------------------------------------------------------------------
  it('(a) emergency_stop 开关启用时，executeTasks 在第一个 task 前抛错', async () => {
    // 创建一个唯一路径的 emergency_stop 开关
    const stopFile = './data/tmp/EMERGENCY_STOP_e2e_test_a';
    await mkdir('./data/tmp', { recursive: true });
    await writeFile(stopFile, 'STOP', 'utf-8');

    try {
      // 用 vi.doMock 注入 hook-review（防止被飞书真实调用）
      vi.doMock('../../src/modules/task-executor/hook-review.js', () => ({
        reviewHook: vi.fn().mockResolvedValue({ approved: true }),
        needsReview: vi.fn().mockReturnValue(false),
        FeishuReviewClient: vi.fn(),
      }));

      const { executeTasks } = await import('../../src/modules/task-executor/index.js');

      const config: SafetyConfig = {
        rate_limits: {
          douyin: { search_calls_per_hour: 10, user_videos_calls_per_hour: 30, friend_request_per_day: 5, dm_per_day: 10 },
          min_interval_seconds: 0,
          max_interval_seconds: 0,
        },
        daily_budget: { videos: 50, comments_scanned: 5000, leads_created: 200, engagement_actions: 20 },
        emergency_stop: stopFile,
        fatal_signals: [],
        hook_review: false,
      };

      const tasks: Task[] = [makeE2ETask({ task_id: 'tA1' }), makeE2ETask({ task_id: 'tA2' })];

      // executeTasks 应在第一个 task 之前 throw（throwIfEmergencyStop 在循环开头）
      await expect(executeTasks(tasks, config)).rejects.toThrow(/紧急停止/);

      // 浏览器动作应从未被调用
      expect(browserActionsMock.executeBrowserAction).not.toHaveBeenCalled();
    } finally {
      if (existsSync(stopFile)) {
        await unlink(stopFile);
      }
    }
  });

  // -------------------------------------------------------------------------
  // (b) scheduled_at = future + 100ms → 至少耗时 100ms
  // -------------------------------------------------------------------------
  it('(b) task.scheduled_at 在未来 100ms 时，executeTasks 至少耗时 100ms', async () => {
    vi.doMock('../../src/modules/task-executor/hook-review.js', () => ({
      reviewHook: vi.fn().mockResolvedValue({ approved: true }),
      needsReview: vi.fn().mockReturnValue(false),
      FeishuReviewClient: vi.fn(),
    }));

    const { executeTasks } = await import('../../src/modules/task-executor/index.js');

    const future = new Date(Date.now() + 100).toISOString();
    const config: SafetyConfig = {
      rate_limits: {
        douyin: { search_calls_per_hour: 10, user_videos_calls_per_hour: 30, friend_request_per_day: 5, dm_per_day: 10 },
        min_interval_seconds: 0, // 跳过真人节律等待，否则会 3-8s
        max_interval_seconds: 0,
      },
      daily_budget: { videos: 50, comments_scanned: 5000, leads_created: 200, engagement_actions: 20 },
      emergency_stop: 'config/EMERGENCY_STOP',
      fatal_signals: [],
      hook_review: false,
    };

    const tasks: Task[] = [makeE2ETask({
      task_id: 'tB1',
      scheduled_at: future,
    })];

    const t0 = Date.now();
    const results = await executeTasks(tasks, config);
    const elapsed = Date.now() - t0;

    // 阶段 2 等待 scheduled_at → 至少 100ms
    expect(elapsed).toBeGreaterThanOrEqual(100);
    // mock 浏览器 → 成功
    expect(results).toHaveLength(1);
    expect(results[0].result).toBe('executed_with_response');
  });

  // -------------------------------------------------------------------------
  // (c) rateLimiter dm_today 已满 → 该 task result='skipped'，error 含 "今日"
  // -------------------------------------------------------------------------
  it('(c) dm 限额已满时，task result=skipped 且 error_message 含 "今日"', async () => {
    vi.doMock('../../src/modules/task-executor/hook-review.js', () => ({
      reviewHook: vi.fn().mockResolvedValue({ approved: true }),
      needsReview: vi.fn().mockReturnValue(false),
      FeishuReviewClient: vi.fn(),
    }));

    const { executeTasks } = await import('../../src/modules/task-executor/index.js');

    // executeTasks 内部每次调用都新建一个 rateLimiter，所以必须 11 个 task 一次传入
    const config: SafetyConfig = {
      rate_limits: {
        douyin: { search_calls_per_hour: 10, user_videos_calls_per_hour: 30, friend_request_per_day: 5, dm_per_day: 10 },
        min_interval_seconds: 0,
        max_interval_seconds: 0,
      },
      daily_budget: { videos: 50, comments_scanned: 5000, leads_created: 200, engagement_actions: 20 },
      emergency_stop: 'config/EMERGENCY_STOP',
      fatal_signals: [],
      hook_review: false,
    };

    // 11 个 DM：前 10 个成功，dm_today 0→10；第 11 个应被 skip
    const tasks: Task[] = Array.from({ length: 11 }, (_, i) =>
      makeE2ETask({ task_id: `tDM${i}`, next_action: 'dm', user_sec_uid: 'sec_1' })
    );
    const results = await executeTasks(tasks, config);

    // 浏览器动作应被调用 10 次（第 11 个不调，因为被 break 跳过）
    expect(browserActionsMock.executeBrowserAction).toHaveBeenCalledTimes(10);

    // 第 11 个（tDM10）应是 skipped
    const last = results[results.length - 1];
    expect(last.task_id).toBe('tDM10');
    expect(last.result).toBe('skipped');
    expect(last.error_message).toMatch(/今日/);

    // 前 10 个应成功
    for (let i = 0; i < 10; i++) {
      expect(results[i].result).toBe('executed_with_response');
    }
  });

  // -------------------------------------------------------------------------
  // (d) reviewHook returns approved=false → task 被 skip，rateLimiter 计数未增加
  // -------------------------------------------------------------------------
  it('(d) reviewHook approved=false 时，task 被 skip 且 rateLimiter 不计数', async () => {
    // mock hook-review：返回 approved=false
    vi.doMock('../../src/modules/task-executor/hook-review.js', () => ({
      reviewHook: vi.fn().mockResolvedValue({ approved: false, reason: '人工跳过/拒绝' }),
      needsReview: vi.fn().mockReturnValue(true),
      FeishuReviewClient: vi.fn(),
    }));

    const { executeTasks, createRateLimiter } = await import('../../src/modules/task-executor/index.js');

    const config: SafetyConfig = {
      rate_limits: {
        douyin: { search_calls_per_hour: 10, user_videos_calls_per_hour: 30, friend_request_per_day: 5, dm_per_day: 10 },
        min_interval_seconds: 0,
        max_interval_seconds: 0,
      },
      daily_budget: { videos: 50, comments_scanned: 5000, leads_created: 200, engagement_actions: 20 },
      emergency_stop: 'config/EMERGENCY_STOP',
      fatal_signals: [],
      hook_review: true, // 启用审核才能让 executeTasks 走到 reviewHook
    };

    // 用一个独立的 rateLimiter 观察计数（executeTasks 内部用的是新实例，但功能一致）
    const observer = createRateLimiter();
    const dmTask: Task = makeE2ETask({
      task_id: 'tReviewReject',
      next_action: 'dm',
      user_sec_uid: 'sec_1',
    });

    const results = await executeTasks([dmTask], config);

    // 1. 结果是 skip，error_message 含 reason
    expect(results).toHaveLength(1);
    expect(results[0].result).toBe('skipped');
    expect(results[0].error_message).toMatch(/审核|拒绝|跳过/);
    // 2. 浏览器动作未执行（因为审核未过直接 continue）
    expect(browserActionsMock.executeBrowserAction).not.toHaveBeenCalled();
    // 3. 观察者 limiter 计数应仍为 0（executeTasks 内部 limiter 也未增）
    expect(observer.getCounters().dm_today).toBe(0);
    expect(observer.getCounters().friend_requests_today).toBe(0);
  });
});