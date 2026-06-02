/**
 * 任务执行器（§3.6.5）
 *
 * 登录态浏览器 + 限速 + 风控信号 + 紧急停止 + 钩子审核
 *
 * V1 实现：mock 浏览器（不真调），留接口便于后续升级
 */

import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Task, TaskAction, TaskResult, Lead, CRMAdapter, LeadStatus } from '../../core/types.js';
import { recordTaskExecuted } from '../feedback-analyzer/event-recorder.js';
import { safetyConfigSchema, formatZodError } from '../../core/config-schemas.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'task-executor' });

// ---------------------------------------------------------------------------
// SafetyConfig（从 config/safety.json 读取）
// ---------------------------------------------------------------------------

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
  hook_review?: boolean;  // 默认 true
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

// ---------------------------------------------------------------------------
// 安全配置加载
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 紧急停止检查
// ---------------------------------------------------------------------------

export function isEmergencyStop(config: SafetyConfig): boolean {
  return existsSync(config.emergency_stop);
}

export function throwIfEmergencyStop(config: SafetyConfig): void {
  if (isEmergencyStop(config)) {
    throw new Error('紧急停止开关已启用，终止执行');
  }
}

// ---------------------------------------------------------------------------
// 限速器
// ---------------------------------------------------------------------------

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
  // 从磁盘加载当前日期的计数器；进程崩了重启能续
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
      // 文件损坏时回退默认 0，避免阻塞执行
      return { friend_requests_today: 0, dm_today: 0, last_action_ms: 0 };
    }
  }

  function persistToDisk(): void {
    const filePath = getRateCountersPath();
    const tmpPath = `${filePath}.tmp`;
    mkdirSync(RATE_COUNTERS_DIR, { recursive: true });
    writeFileSync(tmpPath, JSON.stringify(counters, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);  // 原子替换
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

    /** 随机间隔（3-8 秒真人节律） */
    randomInterval(config: SafetyConfig): number {
      const { min_interval_seconds, max_interval_seconds } = config.rate_limits;
      return Math.floor(Math.random() * (max_interval_seconds - min_interval_seconds + 1) + min_interval_seconds) * 1000;
    },

    /** 等待随机间隔（真人节律） */
    async waitForInterval(config: SafetyConfig): Promise<void> {
      const ms = this.randomInterval(config);
      await new Promise(resolve => setTimeout(resolve, ms));
      counters.last_action_ms = Date.now();
    },

    /** 重置每日计数（删文件实现自然重置，跨日也走文件不存在→0） */
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

// ---------------------------------------------------------------------------
// 钩子审核
// ---------------------------------------------------------------------------

export interface HookReviewResult {
  approved: boolean;
  modified_hook?: string;
  reason?: string;
}

import type { HookReviewConfig } from './hook-review.js';

/**
 * 钩子审核（re-export 真实飞书实现，见 ./hook-review.js）
 * 保留旧签名的便利函数：把 boolean 自动包装成 {enabled: boolean}
 */
export async function reviewHook(
  task: Task,
  config: boolean | HookReviewConfig = false
): Promise<HookReviewResult> {
  const realConfig: HookReviewConfig =
    typeof config === 'boolean' ? { enabled: config } : config;
  const { reviewHook: realReviewHook } = await import('./hook-review.js');
  return realReviewHook(task, realConfig);
}

// re-export 真实飞书 hook-review
export type { HookReviewConfig } from './hook-review.js';

// ---------------------------------------------------------------------------
// 浏览器执行（V1.4 真实 puppeteer-core，§3.6.5）
// ---------------------------------------------------------------------------

export interface BrowserExecuteOptions {
  /** CRM adapter：executeTasks 末尾按 action 推进 lead.status（Finding 2） */
  crm?: CRMAdapter;
}

/**
 * 通过登录态浏览器执行单个任务（基于 BrowserBridge）
 */
export async function browserExecute(
  task: Task,
  _opts: BrowserExecuteOptions = {}
): Promise<ExecutionResult> {
  const { executeBrowserAction } = await import('./browser-actions.js');
  return executeBrowserAction(task);
}


// ---------------------------------------------------------------------------
// 批量任务执行
// ---------------------------------------------------------------------------

export async function executeTasks(
  tasks: Task[],
  config: SafetyConfig,
  opts: BrowserExecuteOptions = {}
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  const rateLimiter = createRateLimiter();
  // 兼容旧的 boolean 写法；新写法是对象
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
    // 1. 检查紧急停止开关
    throwIfEmergencyStop(config);

    // 2. 等待到 scheduled_at
    const scheduledMs = new Date(task.scheduled_at).getTime();
    const now = Date.now();
    if (scheduledMs > now) {
      await new Promise(resolve => setTimeout(resolve, scheduledMs - now));
    }

    // 3. 钩子审核（如需）
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

    // 4. 使用修改后的钩子（如有）
    const taskToExecute = reviewResult.modified_hook
      ? { ...task, hook: reviewResult.modified_hook }
      : task;

    // 5. 限速检查
    if (taskToExecute.next_action === 'friend_request' && !rateLimiter.canFriendRequest(config)) {
      results.push({
        task_id: taskToExecute.task_id,
        lead_cid: taskToExecute.lead_cid,
        action: taskToExecute.next_action,
        result: 'skipped',
        executed_at: new Date().toISOString(),
        error_message: '今日好友申请已达上限',
      });
      break;
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
      break;
    }

    // 6. 真人节律随机延迟
    await rateLimiter.waitForInterval(config);

    // 7. 执行
    const result = await browserExecute(taskToExecute, opts);

    // 8. 限速计数
    if (taskToExecute.next_action === 'friend_request') {
      rateLimiter.recordFriendRequest();
    }
    if (taskToExecute.next_action === 'dm') {
      rateLimiter.recordDm();
    }

    results.push(result);

    // F3: 接入事件记录器（fire-and-forget，错误吞掉避免影响主流程）
    void recordTaskExecuted(taskToExecute.lead_cid, {
      keyword: '',
      hook_style: taskToExecute.hook_style,
      hook_text: taskToExecute.hook,
      persona: taskToExecute.persona,
      interaction_time: new Date().toISOString(),
    }).catch(() => {});

    // 8.5 CRM 回写（Finding 2）：按 next_action 推进 lead.status
    // 失败 best-effort，不中断主流程
    if (opts.crm && result.result !== 'skipped') {
      const newState = nextStateForAction(taskToExecute.next_action, taskToExecute.current_state);
      if (newState) {
        try {
          await opts.crm.updateStatus(taskToExecute.lead_cid, newState, `执行 ${taskToExecute.next_action} 成功`);
        } catch (e) {
          log.warn({ err: e, lead_cid: taskToExecute.lead_cid }, 'CRM 回写失败');
        }
      }
    }

    // 9. 风控信号检测
    if (result.risk_signal) {
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

// ---------------------------------------------------------------------------
// Finding 2：根据 next_action 推断新状态（CRM 回写用）
// ---------------------------------------------------------------------------

const ACTION_TO_NEW_STATE: Partial<Record<TaskAction, LeadStatus>> = {
  like_and_follow: '已关注',
  comment_reply: '已互动',
  friend_request: '已加好友',
  dm: '已私信',
  send_material: '已加微',
};

/**
 * 根据 next_action 推断应推进到的新状态。
 * 优先按"动作 → 新状态"映射（覆盖大部分场景）；若 current_state 已超过目标，
 * 则保持 current_state（避免倒推）。
 */
function nextStateForAction(action: TaskAction, currentState: LeadStatus): LeadStatus | null {
  const candidate = ACTION_TO_NEW_STATE[action];
  if (!candidate) return null;
  // 若已有状态比 candidate 更靠后（如 "已加微"），不倒推
  const order: LeadStatus[] = ['新发现', '已关注', '已互动', '已加好友', '已私信', '已加微', '已预约', '已成交'];
  const currentIdx = order.indexOf(currentState);
  const candidateIdx = order.indexOf(candidate);
  if (currentIdx >= 0 && candidateIdx >= 0 && currentIdx > candidateIdx) return null;
  return candidate;
}

// ---------------------------------------------------------------------------
// 风控信号处理
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

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

  // 读取任务和配置
  const tasks: Task[] = JSON.parse(await readFile(tasksPath, 'utf-8'));
  const config = loadSafetyConfig(configPath);

  // 执行
  const results = await executeTasks(tasks, config);

  // 输出结果
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  log.info({ count: results.length, outputPath }, '执行任务完成');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}