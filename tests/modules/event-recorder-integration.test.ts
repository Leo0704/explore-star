import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Lead, BusinessProfile, ConversionConfig, Task, SafetyConfig } from '../../src/core/types.js';

const profile: BusinessProfile = {
  business: { name: 'Test', value_prop: 'Test' },
  target_personas: [
    { id: 'self_media', name: '自媒体', typical_pain_points: ['x'], value_score: 9.0 },
  ],
  intent_signals: ['AI'],
  llm: { provider: 'deepseek', model: 'deepseek-v3', api_key_env: 'X' },
  crm: { type: 'csv', config: {} },
};

const conversion: ConversionConfig = {
  lifecycle_states: [
    { id: 'discovered', name: '新发现', is_terminal: false },
    { id: 'closed', name: '已成交', is_terminal: true },
    { id: 'lost', name: '已流失', is_terminal: true },
  ],
  success_states: ['closed'],
};

function mkLead(overrides: Partial<Lead> = {}): Lead {
  return {
    cid: 'c1',
    source: 'douyin_user_videos',
    aweme_id: 'v1',
    video_url: 'https://...',
    video_desc: 'desc',
    keyword: 'kw1',
    nickname: 'Test',
    user_signature: '',
    follower_count: 0,
    user_uid: 'u1',
    comment_text: 'hi',
    comment_digg_count: 0,
    comment_create_time: new Date().toISOString(),
    is_target_persona: true,
    persona: 'self_media',
    pain_point: 'p',
    intent_score: 0.8,
    buying_stage: 'awareness',
    suggested_reply_hook: 'h1',
    suggested_dm_hook: 'h2',
    status: '新发现',
    status_history: [],
    execution_count: 0,
    response_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

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
    scheduled_at: new Date(Date.now() - 1000).toISOString(),
    reason: '测试',
    video_url: 'https://douyin.com/video/123',
    ...overrides,
  };
}

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

describe('F3 事件记录器接入', () => {
  const eventRecorderMock = {
    recordEvent: vi.fn().mockResolvedValue(undefined),
    recordStatusChange: vi.fn().mockResolvedValue(undefined),
    recordTaskExecuted: vi.fn().mockResolvedValue(undefined),
  };

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
    vi.doMock('../../src/modules/feedback-analyzer/event-recorder.js', () => eventRecorderMock);
    vi.doMock('../../src/modules/task-executor/browser-actions.js', () => browserActionsMock);
    eventRecorderMock.recordEvent.mockClear();
    eventRecorderMock.recordStatusChange.mockClear();
    eventRecorderMock.recordTaskExecuted.mockClear();
    browserActionsMock.executeBrowserAction.mockClear();
  });

  afterEach(() => {
    vi.doUnmock('../../src/modules/feedback-analyzer/event-recorder.js');
    vi.doUnmock('../../src/modules/task-executor/browser-actions.js');
    vi.doUnmock('../../src/modules/task-executor/hook-review.js');
    vi.resetModules();
  });

  it('executeTasks: 每个 task 执行后调一次 recordTaskExecuted', async () => {
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

    const tasks: Task[] = [
      mkTask({ task_id: 'tA' }),
      mkTask({ task_id: 'tB' }),
      mkTask({ task_id: 'tC' }),
    ];

    await executeTasks(tasks, config);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(eventRecorderMock.recordTaskExecuted).toHaveBeenCalledTimes(3);

    const firstCallArgs = eventRecorderMock.recordTaskExecuted.mock.calls[0];
    expect(firstCallArgs[0]).toBe('c1');
    expect(firstCallArgs[1].hook_style).toBe('default');
    expect(firstCallArgs[1].persona).toBe('self_media');
  });

  it('generateDailyTasks: lead.status 变化时调 recordStatusChange（含 metadata）', async () => {
    const { generateDailyTasks } = await import('../../src/modules/nurture-engine/index.js');

    const lead = mkLead({
      last_task_executed_at: new Date().toISOString(),
      last_task_result: '被拒',
      execution_count: 1,
    });

    const tasks = generateDailyTasks([lead], { profile, conversion });

    await new Promise<void>(resolve => setImmediate(resolve));

    expect(lead.status).toBe('已流失');
    expect(eventRecorderMock.recordStatusChange).toHaveBeenCalledTimes(1);
    const callArgs = eventRecorderMock.recordStatusChange.mock.calls[0];
    expect(callArgs[0]).toBe('c1');
    expect(callArgs[2]).toBe('已流失');
    expect(callArgs[3].persona).toBe('self_media');
    expect(callArgs[3].hook_style).toBeDefined();
  });

  it('applyAbandonmentLogic: 0 回应上限 → 标记已流失，调 recordStatusChange', async () => {
    const { generateDailyTasks } = await import('../../src/modules/nurture-engine/index.js');

    const lead = mkLead({
      last_task_executed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      last_task_result: '无回应',
      execution_count: 3,
      response_count: 0,
    });

    generateDailyTasks([lead], { profile, conversion });

    await new Promise<void>(resolve => setImmediate(resolve));

    expect(lead.status).toBe('已流失');
    expect(eventRecorderMock.recordStatusChange).toHaveBeenCalled();
    const lastCall = eventRecorderMock.recordStatusChange.mock.calls[eventRecorderMock.recordStatusChange.mock.calls.length - 1];
    expect(lastCall[0]).toBe('c1');
    expect(lastCall[2]).toBe('已流失');
  });
});
