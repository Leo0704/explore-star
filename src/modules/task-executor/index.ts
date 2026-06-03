import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, unlinkSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task, TaskAction, TaskResult, Lead, CRMAdapter, LeadStatus } from '../../core/types.js';
import { recordTaskExecuted } from '../feedback-analyzer/event-recorder.js';
import { safetyConfigSchema, formatZodError } from '../../core/config-schemas.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'task-executor' });

const RISK_SIGNALS_LOG = './logs/risk-signals.jsonl';

export interface SafetyConfig {
  rate_limits: {
    douyin: {
      search_calls_per_hour: number;
      user_videos_calls_per_hour: number;
      friend_request_per_day: number;
      dm_per_day: number;
    };
    min_interval_seconds: number;
    max_interval_seconds: number;
  };
  daily_budget: {
    videos: number;
    comments_scanned: number;
    leads_created: number;
    engagement_actions: number;
  };
  emergency_stop: string;
  fatal_signals: string[];
  hook_review?: boolean;
}

export interface RiskSignal {
  type: 'slider' | 'rate_limit' | 'ip_switch' | 'account_ban' | 'captcha';
  count: number;
  action: 'pause_1h' | 'stop_today' | 'emergency_stop';
}

export interface ExecutionResult {
  task_id: string;
  lead_cid: string;
  action: TaskAction;
  result: TaskResult;
  executed_at: string;
  response_text?: string;
  risk_signal?: RiskSignal;
  error_message?: string;
}

export function loadSafetyConfig(configPath: string = 'config/safety.json'): SafetyConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (e) {
    throw new Error(`读取 ${configPath} 失败：${e instanceof Error ? e.message : String(e)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`解析 ${configPath} 失败（不是合法 JSON）：${e instanceof Error ? e.message : String(e)}`);
  }

  const result = safetyConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(formatZodError(configPath, result.error));
  }

  return result.data as SafetyConfig;
}

export function isEmergencyStop(config: SafetyConfig): boolean {
  return existsSync(config.emergency_stop);
}

export function throwIfEmergencyStop(config: SafetyConfig): void {
  if (isEmergencyStop(config)) {
    throw new Error('紧急停止开关已启用，终止执行');
  }
}

interface RateLimitCounters {
  friend_requests_today: number;
  dm_today: number;
  last_action_ms: number;
}

const RATE_COUNTERS_DIR = 'data';

function getRateCountersPath(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return join(RATE_COUNTERS_DIR, `rate-counters-${yyyy}-${mm}-${dd}.json`);
}

export function createRateLimiter() {
  const counters: RateLimitCounters = loadFromDisk();

  function loadFromDisk(): RateLimitCounters {
    const filePath = getRateCountersPath();
    if (!existsSync(filePath)) {
      return { friend_requests_today: 0, dm_today: 0, last_action_ms: 0 };
    }
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<RateLimitCounters>;
      return {
        friend_requests_today: Number(parsed.friend_requests_today) || 0,
        dm_today: Number(parsed.dm_today) || 0,
        last_action_ms: Number(parsed.last_action_ms) || 0,
      };
    } catch {
      return { friend_requests_today: 0, dm_today: 0, last_action_ms: 0 };
    }
  }

  function persistToDisk(): void {
    const filePath = getRateCountersPath();
    const tmpPath = `${filePath}.tmp`;
    mkdirSync(RATE_COUNTERS_DIR, { recursive: true });
    writeFileSync(tmpPath, JSON.stringify(counters, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  }

  return {
    canFriendRequest(config: SafetyConfig): boolean {
      return counters.friend_requests_today < config.rate_limits.douyin.friend_request_per_day;
    },

    canDm(config: SafetyConfig): boolean {
      return counters.dm_today < config.rate_limits.douyin.dm_per_day;
    },

    recordFriendRequest(): void {
      counters.friend_requests_today++;
      persistToDisk();
    },

    recordDm(): void {
      counters.dm_today++;
      persistToDisk();
    },

    randomInterval(config: SafetyConfig): number {
      const { min_interval_seconds, max_interval_seconds } = config.rate_limits;
      return Math.floor(Math.random() * (max_interval_seconds - min_interval_seconds + 1) + min_interval_seconds) * 1000;
    },

    async waitForInterval(config: SafetyConfig): Promise<void> {
      const ms = this.randomInterval(config);
      await new Promise(resolve => setTimeout(resolve, ms));
      counters.last_action_ms = Date.now();
    },

    resetDaily(): void {
      counters.friend_requests_today = 0;
      counters.dm_today = 0;
      const filePath = getRateCountersPath();
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    },

    getCounters(): Readonly<RateLimitCounters> {
      return { ...counters };
    },
  };
}

export interface HookReviewResult {
  approved: boolean;
  modified_hook?: string;
  reason?: string;
}

import type { HookReviewConfig } from './hook-review.js';

export async function reviewHook(
  task: Task,
  config: boolean | HookReviewConfig = false
): Promise<HookReviewResult> {
  const realConfig: HookReviewConfig =
    typeof config === 'boolean' ? { enabled: config } : config;
  const { reviewHook: realReviewHook } = await import('./hook-review.js');
  return realReviewHook(task, realConfig);
}

export type { HookReviewConfig } from './hook-review.js';

export interface BrowserExecuteOptions {
  crm?: CRMAdapter;
}

export async function browserExecute(
  task: Task,
  _opts: BrowserExecuteOptions = {}
): Promise<ExecutionResult> {
  const { executeBrowserAction } = await import('./browser-actions.js');
  return executeBrowserAction(task);
}


export async function executeTasks(
  tasks: Task[],
  config: SafetyConfig,
  opts: BrowserExecuteOptions = {}
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  const rateLimiter = createRateLimiter();
  const rawHookReview = (config as any).hook_review;
  const hookReviewEnabled: boolean =
    typeof rawHookReview === 'boolean' ? rawHookReview :
    typeof rawHookReview === 'object' && rawHookReview !== null ? (rawHookReview.enabled ?? false) :
    false;
  const hookReviewConfig = {
    enabled: hookReviewEnabled,
    timeoutSeconds: 60,
  };

  for (const task of tasks) {
    throwIfEmergencyStop(config);

    const scheduledMs = new Date(task.scheduled_at).getTime();
    const now = Date.now();
    if (scheduledMs > now) {
      await new Promise(resolve => setTimeout(resolve, scheduledMs - now));
    }

    const reviewResult = await reviewHook(task, hookReviewConfig);
    if (!reviewResult.approved) {
      results.push({
        task_id: task.task_id,
        lead_cid: task.lead_cid,
        action: task.next_action,
        result: 'skipped',
        executed_at: new Date().toISOString(),
        error_message: reviewResult.reason ?? '钩子审核未通过',
      });
      continue;
    }

    const taskToExecute = reviewResult.modified_hook
      ? { ...task, hook: reviewResult.modified_hook }
      : task;

    if (taskToExecute.next_action === 'friend_request' && !rateLimiter.canFriendRequest(config)) {
      results.push({
        task_id: taskToExecute.task_id,
        lead_cid: taskToExecute.lead_cid,
        action: taskToExecute.next_action,
        result: 'skipped',
        executed_at: new Date().toISOString(),
        error_message: '今日好友申请已达上限',
      });
      continue;
    }

    if (taskToExecute.next_action === 'dm' && !rateLimiter.canDm(config)) {
      results.push({
        task_id: taskToExecute.task_id,
        lead_cid: taskToExecute.lead_cid,
        action: taskToExecute.next_action,
        result: 'skipped',
        executed_at: new Date().toISOString(),
        error_message: '今日私信已达上限',
      });
      continue;
    }

    await rateLimiter.waitForInterval(config);

    const result = await browserExecute(taskToExecute, opts);

    if (taskToExecute.next_action === 'friend_request') {
      rateLimiter.recordFriendRequest();
    }
    if (taskToExecute.next_action === 'dm') {
      rateLimiter.recordDm();
    }

    results.push(result);

    void recordTaskExecuted(taskToExecute.lead_cid, {
      keyword: taskToExecute.source_keyword ?? '',
      hook_style: taskToExecute.hook_style,
      hook_text: taskToExecute.hook,
      persona: taskToExecute.persona,
      interaction_time: new Date().toISOString(),
    }).catch(() => {});

    if (opts.crm && result.result !== 'skipped' && !result.result.startsWith('failed')) {
      const newState = nextStateForAction(taskToExecute.next_action, taskToExecute.current_state);
      if (newState) {
        try {
          await opts.crm.updateStatus(taskToExecute.lead_cid, newState, `执行 ${taskToExecute.next_action} 成功`);
        } catch (e) {
          log.warn({ err: e, lead_cid: taskToExecute.lead_cid }, 'CRM 回写失败');
        }
      }
    }

    if (result.risk_signal) {
      try {
        const dir = './logs';
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        appendFileSync(RISK_SIGNALS_LOG, JSON.stringify({ type: result.risk_signal.type, ts: Date.now() }) + '\n');
      } catch (e) {
        log.warn({ err: e }, '写入风控信号日志失败');
      }

      if (result.risk_signal.action === 'emergency_stop') {
        throw new Error(`风控信号触发：${result.risk_signal.type}，紧急停止`);
      }
      if (result.risk_signal.action === 'stop_today') {
        break;
      }
    }
  }

  return results;
}

const ACTION_TO_NEW_STATE: Partial<Record<TaskAction, LeadStatus>> = {
  like_and_follow: '已关注',
  comment_reply: '已互动',
  friend_request: '已加好友',
  dm: '已私信',
  send_material: '已加微',
};

function nextStateForAction(action: TaskAction, currentState: LeadStatus): LeadStatus | null {
  const candidate = ACTION_TO_NEW_STATE[action];
  if (!candidate) return null;
  if (currentState === '已流失') return null;
  const order: LeadStatus[] = ['新发现', '已关注', '已互动', '已加好友', '已私信', '已加微', '已预约', '已成交'];
  const currentIdx = order.indexOf(currentState);
  const candidateIdx = order.indexOf(candidate);
  if (currentIdx >= 0 && candidateIdx >= 0 && currentIdx > candidateIdx) return null;
  return candidate;
}

export function createRiskSignal(
  type: RiskSignal['type'],
  config: SafetyConfig
): RiskSignal {
  const fatalSignals: Record<string, RiskSignal['action']> = {
    captcha_triggered_3_times_in_1h: 'stop_today',
    private_msg_rejected_2_times: 'emergency_stop',
    ip_changed_5_times: 'emergency_stop',
    account_ban: 'emergency_stop',
  };

  return {
    type,
    count: 1,
    action: fatalSignals[type] ?? 'pause_1h',
  };
}

export async function runCLI(args: string[]): Promise<void> {
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const tasksPath = get('--tasks') || 'data/tmp/tasks.json';
  const configPath = get('--config') || 'config/safety.json';
  const outputPath = get('--output') || 'data/tmp/execution-results.json';

  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');

  const tasks: Task[] = JSON.parse(await readFile(tasksPath, 'utf-8'));
  const config = loadSafetyConfig(configPath);

  const results = await executeTasks(tasks, config);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  log.info({ count: results.length, outputPath }, '执行任务完成');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}