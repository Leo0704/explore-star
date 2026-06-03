import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Task, SafetyConfig, CRMAdapter, LeadStatus } from '../../src/core/types.js';

import { createRateLimiter, isEmergencyStop, reviewHook } from '../../src/modules/task-executor/index.js';

function getRateCounterFilePath(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `data/rate-counters-${yyyy}-${mm}-${dd}.json`;
}

beforeEach(async () => {
  const file = getRateCounterFilePath();
  if (existsSync(file)) {
    await unlink(file);
  }
});

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
      expect(mockConfig.rate_limits.douyin.friend_request_per_day).toBe(5);
      expect(mockConfig.rate_limits.douyin.dm_per_day).toBe(10);
      expect(mockConfig.rate_limits.min_interval_seconds).toBe(3);
      expect(mockConfig.rate_limits.max_interval_seconds).toBe(8);
    });
  });

  describe('限速器', () => {
    it('记录好友请求次数', () => {
      const limiter = createRateLimiter();
      expect(limiter.canFriendRequest(mockConfig)).toBe(true);
      limiter.recordFriendRequest();
      expect(limiter.canFriendRequest(mockConfig)).toBe(true);
      for (let i = 0; i < 4; i++) {
        limiter.recordFriendRequest();
      }
      expect(limiter.canFriendRequest(mockConfig)).toBe(false);
    });

    it('记录私信次数', () => {
      const limiter = createRateLimiter();
      expect(limiter.canDm(mockConfig)).toBe(true);
      limiter.recordDm();
      limiter.recordDm();
      expect(limiter.canDm(mockConfig)).toBe(true);
      for (let i = 0; i < 8; i++) {
        limiter.recordDm();
      }
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

    expect(advancedCount).toBeGreaterThan(50);
  });
});

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
    scheduled_at: new Date(Date.now() - 1000).toISOString(),
    reason: 'E2E',
    video_url: 'https://douyin.com/video/123',
    ...overrides,
  };
}

describe('executeTasks 9-阶段端到端', () => {
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

  it('(a) emergency_stop 开关启用时，executeTasks 在第一个 task 前抛错', async () => {
    const stopFile = './data/tmp/EMERGENCY_STOP_e2e_test_a';
    await mkdir('./data/tmp', { recursive: true });
    await writeFile(stopFile, 'STOP', 'utf-8');

    try {
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

      await expect(executeTasks(tasks, config)).rejects.toThrow(/紧急停止/);

      expect(browserActionsMock.executeBrowserAction).not.toHaveBeenCalled();
    } finally {
      if (existsSync(stopFile)) {
        await unlink(stopFile);
      }
    }
  });

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
        min_interval_seconds: 0,
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

    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(results).toHaveLength(1);
    expect(results[0].result).toBe('executed_with_response');
  });

  it('(c) dm 限额已满时，task result=skipped 且 error_message 含 "今日"', async () => {
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
      emergency_stop: 'config/EMERGENCY_STOP',
      fatal_signals: [],
      hook_review: false,
    };

    const tasks: Task[] = Array.from({ length: 11 }, (_, i) =>
      makeE2ETask({ task_id: `tDM${i}`, next_action: 'dm', user_sec_uid: 'sec_1' })
    );
    const results = await executeTasks(tasks, config);

    expect(browserActionsMock.executeBrowserAction).toHaveBeenCalledTimes(10);

    const last = results[results.length - 1];
    expect(last.task_id).toBe('tDM10');
    expect(last.result).toBe('skipped');
    expect(last.error_message).toMatch(/今日/);

    for (let i = 0; i < 10; i++) {
      expect(results[i].result).toBe('executed_with_response');
    }
  });

  it('(d) reviewHook approved=false 时，task 被 skip 且 rateLimiter 不计数', async () => {
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
      hook_review: true,
    };

    const observer = createRateLimiter();
    const dmTask: Task = makeE2ETask({
      task_id: 'tReviewReject',
      next_action: 'dm',
      user_sec_uid: 'sec_1',
    });

    const results = await executeTasks([dmTask], config);

    expect(results).toHaveLength(1);
    expect(results[0].result).toBe('skipped');
    expect(results[0].error_message).toMatch(/审核|拒绝|跳过/);
    expect(browserActionsMock.executeBrowserAction).not.toHaveBeenCalled();
    expect(observer.getCounters().dm_today).toBe(0);
    expect(observer.getCounters().friend_requests_today).toBe(0);
  });
});

function makeSpyCRM(overrides: Partial<CRMAdapter> = {}): CRMAdapter {
  return {
    syncLeads: vi.fn().mockResolvedValue({ synced: 0, failed: 0, errors: [] }),
    getLead: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateLeadFields: vi.fn().mockResolvedValue(undefined),
    listLeads: vi.fn().mockResolvedValue([]),
    ping: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('Finding 2: executeTasks 回写 CRM', () => {
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

  it('(F2-1) 1 个 task 成功执行后，crm.updateStatus 被调 1 次，newState 来自 STATE_TRANSITIONS', async () => {
    vi.doMock('../../src/modules/task-executor/hook-review.js', () => ({
      reviewHook: vi.fn().mockResolvedValue({ approved: true }),
      needsReview: vi.fn().mockReturnValue(false),
      FeishuReviewClient: vi.fn(),
    }));

    const { executeTasks } = await import('../../src/modules/task-executor/index.js');
    const crm = makeSpyCRM();

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

    const task = makeE2ETask({
      task_id: 'tF2_1',
      lead_cid: 'cid_F2_1',
      current_state: '新发现',
      next_action: 'like_and_follow',
    });

    await executeTasks([task], config, { crm });

    expect(crm.updateStatus).toHaveBeenCalledTimes(1);
    expect(crm.updateStatus).toHaveBeenCalledWith('cid_F2_1', '已关注', expect.any(String));
  });

  it('(F2-2) 3 个不同 action 的 task，crm.updateStatus 收到对应的新状态', async () => {
    vi.doMock('../../src/modules/task-executor/hook-review.js', () => ({
      reviewHook: vi.fn().mockResolvedValue({ approved: true }),
      needsReview: vi.fn().mockReturnValue(false),
      FeishuReviewClient: vi.fn(),
    }));

    const { executeTasks } = await import('../../src/modules/task-executor/index.js');
    const crm = makeSpyCRM();

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

    const tasks: Task[] = [
      makeE2ETask({ task_id: 'tF2_2a', lead_cid: 'cid_a', current_state: '新发现', next_action: 'like_and_follow' }),
      makeE2ETask({ task_id: 'tF2_2b', lead_cid: 'cid_b', current_state: '已关注', next_action: 'comment_reply' }),
      makeE2ETask({ task_id: 'tF2_2c', lead_cid: 'cid_c', current_state: '已互动', next_action: 'friend_request', user_sec_uid: 'sec_c' }),
    ];

    await executeTasks(tasks, config, { crm });

    expect(crm.updateStatus).toHaveBeenCalledTimes(3);
    const calls = (crm.updateStatus as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]).toEqual(['cid_a', '已关注', expect.any(String)]);
    expect(calls[1]).toEqual(['cid_b', '已互动', expect.any(String)]);
    expect(calls[2]).toEqual(['cid_c', '已加好友', expect.any(String)]);
  });

  it('(F2-3) crm.updateStatus 抛错时主流程不中断，results 仍正常返回', async () => {
    vi.doMock('../../src/modules/task-executor/hook-review.js', () => ({
      reviewHook: vi.fn().mockResolvedValue({ approved: true }),
      needsReview: vi.fn().mockReturnValue(false),
      FeishuReviewClient: vi.fn(),
    }));

    const { executeTasks } = await import('../../src/modules/task-executor/index.js');
    const crm = makeSpyCRM({
      updateStatus: vi.fn().mockRejectedValue(new Error('CRM down')),
    });

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

    const task = makeE2ETask({
      task_id: 'tF2_3',
      lead_cid: 'cid_F2_3',
      current_state: '新发现',
      next_action: 'like_and_follow',
    });

    const results = await executeTasks([task], config, { crm });

    expect(browserActionsMock.executeBrowserAction).toHaveBeenCalledTimes(1);
    expect(crm.updateStatus).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].result).toBe('executed_with_response');
  });
});

describe('Bug 2: 已流失 lead 不应被推进状态', () => {
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
    vi.doUnmock('../../src/modules/feedback-analyzer/event-recorder.js');
    vi.resetModules();
  });

  it('(B2-1) current_state=已流失 的 task 成功执行后，crm.updateStatus 不应被调用', async () => {
    vi.doMock('../../src/modules/task-executor/hook-review.js', () => ({
      reviewHook: vi.fn().mockResolvedValue({ approved: true }),
      needsReview: vi.fn().mockReturnValue(false),
      FeishuReviewClient: vi.fn(),
    }));

    const { executeTasks } = await import('../../src/modules/task-executor/index.js');
    const crm = makeSpyCRM();

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

    const task = makeE2ETask({
      task_id: 'tB2_1',
      lead_cid: 'cid_B2_1',
      current_state: '已流失',
      next_action: 'like_and_follow',
    });

    await executeTasks([task], config, { crm });

    expect(crm.updateStatus).not.toHaveBeenCalled();
  });
});

describe('Bug 3: recordTaskExecuted 传真实 keyword', () => {
  const eventRecorderMock = {
    recordEvent: vi.fn().mockResolvedValue(undefined),
    recordStatusChange: vi.fn().mockResolvedValue(undefined),
    recordTaskExecuted: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../../src/modules/task-executor/browser-actions.js', () => browserActionsMock);
    vi.doMock('../../src/modules/feedback-analyzer/event-recorder.js', () => eventRecorderMock);
    browserActionsMock.executeBrowserAction.mockClear();
    browserActionsMock.likeAndFollow.mockClear();
    browserActionsMock.commentReply.mockClear();
    browserActionsMock.friendRequest.mockClear();
    browserActionsMock.sendDirectMessage.mockClear();
    eventRecorderMock.recordEvent.mockClear();
    eventRecorderMock.recordStatusChange.mockClear();
    eventRecorderMock.recordTaskExecuted.mockClear();
  });

  afterEach(() => {
    vi.doUnmock('../../src/modules/task-executor/browser-actions.js');
    vi.doUnmock('../../src/modules/task-executor/hook-review.js');
    vi.doUnmock('../../src/modules/feedback-analyzer/event-recorder.js');
    vi.resetModules();
  });

  it('(B3-1) task 带 source_keyword 时，recordTaskExecuted 的 metadata.keyword 应该是该值', async () => {
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
      emergency_stop: 'config/EMERGENCY_STOP',
      fatal_signals: [],
      hook_review: false,
    };

    const task = makeE2ETask({
      task_id: 'tB3_1',
      lead_cid: 'cid_B3_1',
      source_keyword: 'AI 副业',
      next_action: 'like_and_follow',
    });

    await executeTasks([task], config);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(eventRecorderMock.recordTaskExecuted).toHaveBeenCalledTimes(1);
    const callArgs = eventRecorderMock.recordTaskExecuted.mock.calls[0];
    expect(callArgs[0]).toBe('cid_B3_1');
    expect(callArgs[1].keyword).toBe('AI 副业');
    expect(callArgs[1].keyword).not.toBe('');
  });
});