/**
 * 任务执行器（§3.6.5）
 *
 * 登录态浏览器 + 限速 + 风控信号 + 紧急停止 + 钩子审核
 *
 * V1 实现：mock 浏览器（不真调），留接口便于后续升级
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Task, TaskAction, TaskResult, Lead } from '../../core/types.js';

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
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as SafetyConfig;
  } catch {
    // fallback 默认值
    return {
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
    };
  }
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

export function createRateLimiter() {
  const counters: RateLimitCounters = {
    friend_requests_today: 0,
    dm_today: 0,
    last_action_ms: 0,
  };

  return {
    canFriendRequest(config: SafetyConfig): boolean {
      return counters.friend_requests_today < config.rate_limits.douyin.friend_request_per_day;
    },

    canDm(config: SafetyConfig): boolean {
      return counters.dm_today < config.rate_limits.douyin.dm_per_day;
    },

    recordFriendRequest(): void {
      counters.friend_requests_today++;
    },

    recordDm(): void {
      counters.dm_today++;
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

    /** 重置每日计数（供编排器在每天开始时调用） */
    resetDaily(): void {
      counters.friend_requests_today = 0;
      counters.dm_today = 0;
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
  /** Chrome 用户数据目录（探星Profile） */
  chromeProfile?: string;
  /** Chrome 可执行文件路径 */
  executablePath?: string;
  headless?: boolean;
  /** 注入 fake browser 用于单测（不允许用于生产） */
  __fakeBrowser?: import('puppeteer-core').Browser;
}

/**
 * 通过登录态浏览器执行单个任务（V1.4 真浏览器）
 */
export async function browserExecute(
  task: Task,
  opts: BrowserExecuteOptions = {}
): Promise<ExecutionResult> {
  const { executeBrowserAction } = await import('./browser-actions.js');

  // 单元测试路径：允许注入 fake browser（__fakeBrowser）来 mock puppeteer；
  // 这里 mock 的是 puppeteer 库本身，不是 action 逻辑
  if (opts.__fakeBrowser) {
    return executeBrowserActionWithBrowser(task, opts.__fakeBrowser);
  }

  const browserConfig = {
    executablePath: opts.executablePath,
    userDataDir: opts.chromeProfile ?? '~/.config/google-chrome/Default',
    headless: opts.headless ?? false,
  };

  return executeBrowserAction(task, browserConfig);
}

async function executeBrowserActionWithBrowser(
  task: Task,
  browser: import('puppeteer-core').Browser
): Promise<ExecutionResult> {
  // 单测 helper：直接复用 browser-actions 的真逻辑，但注入 fake browser
  const { likeAndFollow, commentReply, friendRequest, sendDirectMessage } = await import('./browser-actions.js');
  const customFields = (task as any).custom_fields ?? {};
  const videoUrl = customFields.video_url as string | undefined;
  const userSecUid = customFields.user_sec_uid as string | undefined;
  const baseResult: ExecutionResult = {
    task_id: task.task_id,
    lead_cid: task.lead_cid,
    action: task.next_action,
    result: 'executed_with_response',
    executed_at: new Date().toISOString(),
  };
  if (task.next_action === 'send_material') return baseResult;

  let outcome;
  switch (task.next_action) {
    case 'like_and_follow':
      if (!videoUrl) return { ...baseResult, result: 'failed_network', error_message: 'no video_url' };
      outcome = await likeAndFollow(videoUrl, browser);
      break;
    case 'comment_reply':
      if (!videoUrl) return { ...baseResult, result: 'failed_network', error_message: 'no video_url' };
      outcome = await commentReply(videoUrl, task.hook, browser);
      break;
    case 'friend_request':
      if (!userSecUid) return { ...baseResult, result: 'failed_network', error_message: 'no user_sec_uid' };
      outcome = await friendRequest(userSecUid, browser);
      break;
    case 'dm':
      if (!userSecUid) return { ...baseResult, result: 'failed_network', error_message: 'no user_sec_uid' };
      outcome = await sendDirectMessage(userSecUid, task.hook, browser);
      break;
    default:
      return { ...baseResult, result: 'skipped' };
  }
  if (!outcome.ok) {
    if (outcome.riskSignal) return { ...baseResult, result: 'failed_risk', risk_signal: outcome.riskSignal };
    return { ...baseResult, result: 'failed_network', error_message: outcome.error };
  }
  return baseResult;
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
  console.log(`[task-executor] 执行 ${results.length} 任务 → ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}