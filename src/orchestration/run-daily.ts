/**
 * 每日编排器（§3.7）
 *
 * V1.4 增强：
 *   - 串联 7 步（侦察→分析→同步→任务→执行→通知→健康检查）
 *   - 支持断点续传（state.ts）
 *   - 支持 --dry-run / --skip-llm / --step
 *
 * Phase 0 PR 1：在 finally 块写 run_history（data/run_history.jsonl）
 *   - runDaily 主体加 try/catch/finally
 *   - runDailyBody 签名加 stepDurations + phaseCounts 输出参数
 *   - 每个 step 入口/出口加 step 计时
 *   - 收尾填 phaseCounts
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getChannel, getNotifier, setChannelConfigPath } from '../adapters/registry.js';
import type { Comment, Lead, Notifier, BusinessProfile, Task } from '../core/types.js';
import { executeTasks, loadSafetyConfig, type ExecutionResult, type SafetyConfig } from '../modules/task-executor/index.js';
import { loadState, updateStep, markComplete, resetForNewDay } from './state.js';
import { logger } from '../core/logger.js';
import { appendRunHistory, type RunHistoryEntry } from './run-history.js';
import { resolveNotifiers as defaultResolveNotifiers } from '../core/notifier-resolver.js';
import { CostTracker } from '../adapters/llm/_cost-tracker.js';
import { checkAll } from './health-check.js';
import { RateLimiter, type ChannelRateLimitsConfig } from '../core/rate-limiter.js';
import { CircuitBreaker } from '../core/circuit-breaker.js';

const log = logger.child({ module: 'run-daily' });

/**
 * 当前 run 的子 logger（带 runId / business）。
 * 由 runDaily() 入口设置、退出清理；其他函数读 currentLog 即可拿到 runId 上下文。
 * 不用 AsyncLocalStorage 是因为 logger.child 创建很轻；不用参数穿透是因为要改 5+ 函数签名。
 * 类型用 ReturnType<typeof logger.child> 而不是 log 的类型，因为 runDaily 会用不同 module 串。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentLog: any = log;

export interface RunDailyOptions {
  businessDir: string;
  dryRun?: boolean;
  skipLLM?: boolean;
  dailyTaskLimit?: number;
  videoLimit?: number;
  injectLLM?: { complete(p: string): Promise<string> };
  /** 只跑特定步骤（0-6） */
  step?: number;
  /** 手动开关：read-only 模式跳过 phase 7b（任务执行）。由人通过 CLI 启用，绝不自动降级。 */
  mode?: 'full' | 'read-only';
  /** 测试注入：覆盖 channel（用于 R1 assertLoggedIn 的 mock，避免依赖真 opencli/Chrome） */
  injectChannel?: import('../core/types.js').ChannelAdapter;
  /** 测试注入：覆盖 executeTasks（避免需要真浏览器） */
  injectExecuteTasks?: typeof import('../modules/task-executor/index.js').executeTasks;
  /** 测试注入：覆盖 generateDailyTasks */
  injectGenerateDailyTasks?: typeof import('../modules/nurture-engine/index.js').generateDailyTasks;
  /** 测试注入：自定义 run_history 路径（默认 data/run_history.jsonl） */
  injectHistoryPath?: string;
  /** 测试注入：是否写 history（默认 true；测试可关） */
  injectWriteHistory?: boolean;
  /** 测试注入：覆盖 notifier 列表（默认从 observability 配置读） */
  injectNotifiers?: Notifier[];
  /** 测试注入：覆盖 notifier 解析函数 */
  injectResolveNotifiers?: (profile: BusinessProfile) => Notifier[];
}

export interface RunDailyResult {
  date: string;
  videosScanned: number;
  commentsCollected: number;
  leadsCreated: number;
  tasksGenerated: number;
  tasksExecuted: number;
  duration_ms: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * R1：登录态失效信号。抛出后由 runDaily 外层捕获，触发飞书告警 + 立刻停手。
 *
 * 类定义已迁出到 `core/channel-errors.ts`（Phase 3 #5 多渠道架构准备）。
 * 保留 re-export 以兼容历史 import 路径 `from '../orchestration/run-daily.js'`。
 */
import { LoginRequiredError } from '../core/channel-errors.js';
export { LoginRequiredError };

/** R1：调用 channel.ping() 探测登录态，未登录则抛 LoginRequiredError */
async function assertLoggedIn(channel: import('../core/types.js').ChannelAdapter): Promise<void> {
  const result = await channel.ping();
  if (!result.loggedIn) {
    throw new LoginRequiredError('channel.ping() 返回 loggedIn=false');
  }
}

/** R1：登录失效时打 state 标记 + 飞书告警（fallback console） */
async function handleLoginRequired(businessDir: string): Promise<void> {
  await updateStep(0, 'failed', undefined, 'login_required');

  const message = {
    title: '[探星] 登录失效已停止',
    body: `业务=${businessDir}\n时间=${new Date().toISOString()}\n请重新登录后再次运行`,
    level: 'critical' as const,
  };

  try {
    const feishu = getNotifier('feishu');
    await feishu.send(message);
  } catch {
    // feishu 未注册（缺 FEISHU_WEBHOOK_URL）或发送失败 → fallback console
    const consoleNotifier = getNotifier('console');
    await consoleNotifier.send({ ...message, title: `[fallback:console] ${message.title}` });
  }
}

export async function runDaily(opts: RunDailyOptions): Promise<RunDailyResult> {
  const t0 = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

  // P0-I 修复：构造带 runId 的子 logger，让本次 run 的所有 log 可被 grep 串起来
  const runId = crypto.randomUUID();
  const prevLog = currentLog;
  currentLog = logger.child({ module: 'run-daily', runId, business: opts.businessDir });
  try {
    return await runDailyInner(opts, t0, date, errors, runId);
  } finally {
    currentLog = prevLog;
  }
}

async function runDailyInner(
  opts: RunDailyOptions,
  t0: number,
  date: string,
  errors: string[],
  runId: string,
): Promise<RunDailyResult> {
  currentLog.info({ business: opts.businessDir, date, mode: opts.mode ?? 'full' }, '启动');

  // 检查是否新的一天，如果是则重置状态
  const state = await loadState();
  if (state.date !== date) {
    await resetForNewDay();
  }

  const historyPath = opts.injectHistoryPath ?? './data/run_history.jsonl';
  const writeHistory = opts.injectWriteHistory !== false;
  const startedAt = new Date().toISOString();
  let exitReason: RunHistoryEntry['exit_reason'] = 'failed';
  const stepDurations: Record<string, number> = {};
  const phaseCounts: RunHistoryEntry['phase_counts'] = {
    videos_scanned: 0, comments_collected: 0, leads_created: 0, tasks_generated: 0, tasks_executed: 0,
  };

  try {
    const result = await runDailyBody(opts, t0, date, errors, stepDurations, phaseCounts);
    exitReason = errors.length === 0 ? 'completed' : 'failed';
    return result;
  } catch (e) {
    if (e instanceof LoginRequiredError) {
      exitReason = 'login_required';
      // 立即通知（不等 finally）—— LoginRequiredError 是 R1 fail-loud 信号
      const notifiers = opts.injectNotifiers ?? await loadAndResolveNotifiers(opts);
      for (const n of notifiers) {
        await sendWithTimeout(n, {
          title: '探星：需要登录抖音',
          body: `业务 ${opts.businessDir} 的 run 在 ${new Date().toISOString()} 触发 LoginRequiredError。\n请检查 opencli / Chrome 登录态。`,
          level: 'critical',
        });
      }
      await handleLoginRequired(opts.businessDir);
    } else {
      exitReason = 'failed';
    }
    throw e;
  } finally {
    if (writeHistory) {
      try {
        // Phase 2 #4:cost_estimate 字段(复用 Phase 0 schema,run-history.ts:38-42)
        // runDailyBody 把 snapshot 挂到 opts.costSnapshot;skipLLM 路径下保持全 0
        const costSnapshot = (opts as { costSnapshot?: { prompt_tokens: number; completion_tokens: number; estimated_cost_usd: number } }).costSnapshot;
        const cost_estimate = costSnapshot
          ? {
              prompt_tokens: costSnapshot.prompt_tokens,
              completion_tokens: costSnapshot.completion_tokens,
              estimated_cost_usd: costSnapshot.estimated_cost_usd,
            }
          : { prompt_tokens: 0, completion_tokens: 0, estimated_cost_usd: 0 };
        await appendRunHistory(historyPath, {
          run_id: runId,
          business: opts.businessDir,
          mode: opts.mode ?? 'full',
          dry_run: !!opts.dryRun,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - t0,
          exit_reason: exitReason,
          step_durations: stepDurations,
          phase_counts: phaseCounts,
          errors,
          cost_estimate,
        });
      } catch (historyErr) {
        currentLog.error({ err: historyErr, runId }, '写 run_history 失败（不阻塞主流程）');
      }
    }

    // 失败路径（非 login_required）发 warning 告警；login_required 已在 catch 内发 critical
    // 关键：login_required 在 catch 已发，不再重复发；completed 也不发
    if (exitReason === 'failed') {
      try {
        const notifiers = opts.injectNotifiers ?? await loadAndResolveNotifiers(opts);
        for (const n of notifiers) {
          await sendWithTimeout(n, {
            title: `探星：run 失败 (${exitReason})`,
            body: `业务 ${opts.businessDir} 在 ${new Date().toISOString()} run 失败，exit_reason=${exitReason}，错误数=${errors.length}。\n首条错误：${errors[0] ?? '(无)'}`,
            level: 'warning',
          });
        }
      } catch (notifErr) {
        currentLog.error({ err: notifErr }, 'finally 块 notifier 发送异常（不阻塞）');
      }
    }
  }
}

/** 主流程体（拆出来便于外层 try-catch 统一捕获 LoginRequiredError） */
async function runDailyBody(
  opts: RunDailyOptions,
  t0: number,
  date: string,
  errors: string[],
  stepDurations: Record<string, number>,
  phaseCounts: RunHistoryEntry['phase_counts'],
): Promise<RunDailyResult> {
  // -------------------------------------------------------------------------
  // Step 1: reconnaissance（profile 加载 → 拉评论）
  // Phase 0 PR 1：包 try/catch 加 step 计时
  // 关键：LoginRequiredError 必须重新 throw 到外层 runDaily
  // 关键 2：reconnaissance 内部声明的 const 后续 step 要用 —— 全部 hoist 到 try 外
  // -------------------------------------------------------------------------
  const stepStart_recon = Date.now();
  let loaded: Awaited<ReturnType<typeof loadBusinessProfile>> | null = null;
  let profile: import('../core/types.js').BusinessProfile | null = null;
  let channels: import('../core/types.js').ChannelsConfig | null = null;
  let conversion: import('../core/types.js').ConversionConfig | null = null;
  let knowledgeDir: string | null = null;
  let comments: Comment[] = [];
  let videosScanned = 0;
  // P0-A #1 #2：RateLimiter 和 CircuitBreaker 提到 runDailyBody 顶部
  // 让 recon 和 analysis 两个 step 都能用
  let rateLimiter: RateLimiter | null = null;
  let llmBreaker: CircuitBreaker | null = null;
  try {
    // 1. 加载业务配置
    await updateStep(0, 'running');
    loaded = await loadBusinessProfile(opts.businessDir);
    profile = loaded.profile;
    channels = loaded.channels;
    conversion = loaded.conversion;
    knowledgeDir = loaded.knowledgeDir;
    // Bug 20：把 channel 限流配置路径从 CWD 相对改成业务目录绝对路径
    setChannelConfigPath(join(opts.businessDir, 'channels.yaml'));
    await updateStep(0, 'completed', { mode: channels.source?.mode ?? 'sec_uid' });

    // 2. 注册所有内置 adapter
    await registerBuiltins();

    // 2.5 R1：登录态前置检查 —— 未登录则 throw LoginRequiredError，外层会飞书告警 + 停手
    // 测试可通过 opts.injectChannel 注入 mock channel
    // P0-E 修复：channel 名由 profile.channel.name 决定，默认 'douyin'
    const channelName = profile?.channel?.name ?? 'douyin';
    await assertLoggedIn(opts.injectChannel ?? getChannel(channelName));

    // 3. 选数据源模式
    const mode = channels.source?.mode ?? 'sec_uid';

    // 3.5 keyword/both 模式：用 LLM 从业务画像自动生成搜索关键词
    if (mode === 'keyword' || mode === 'both') {
      const llmForKw = opts.injectLLM
        ? opts.injectLLM
        : (await import('../adapters/registry.js')).getLLM(profile.llm.provider);
      const { generateSearchKeywords, writebackGeneratedKeywords } = await import('../modules/keyword-generator.js');
      const generated = await generateSearchKeywords(profile, llmForKw);
      if (Object.keys(generated).length === 0) {
        // 静默路径
      } else {
        channels.search = {
          ...channels.search,
          keywords: { ...channels.search?.keywords, ...generated },
        };
        currentLog.info({ keywords: Object.keys(generated) }, '合并 LLM 生成的关键词');
        // Bug 15：落盘 channels.yaml，避免下次 run 重复生成
        await writebackGeneratedKeywords(join(opts.businessDir, 'channels.yaml'), generated);
      }
    }

    // P0-A #1 修复：构造 RateLimiter 实例并真正串到 fetch 路径
    // 之前是死代码（0 调用者）。现在它每次 fetch user_videos / search / comments 之前 wait
    const channelRateLimits: ChannelRateLimitsConfig = {
      search_qps: (channels as { channel_rate_limits?: { douyin?: { search_qps?: number } } }).channel_rate_limits?.douyin?.search_qps ?? 1,
      user_videos_qps: (channels as { channel_rate_limits?: { douyin?: { user_videos_qps?: number } } }).channel_rate_limits?.douyin?.user_videos_qps ?? 1,
      comment_qps: (channels as { channel_rate_limits?: { douyin?: { comment_qps?: number } } }).channel_rate_limits?.douyin?.comment_qps ?? 1,
      friend_request_per_day: 5,
      dm_per_day: 10,
    };
    rateLimiter = RateLimiter.fromConfig({
      channelLimits: channelRateLimits,
      adapterLimits: { search_per_hour: 0, user_videos_per_hour: 0, comment_per_hour: 0, friend_request_per_day: 0, dm_per_day: 0 },
    });

    // P0-A #2 修复：构造 LLM CircuitBreaker
    // 阈值 3 次失败 → OPEN 60s。OPEN 时 onOpen 发 critical notifier
    // P0-A #2 完成接线：把 breaker 注入到 batchCtx，让 batch.ts 的 fetcher 闭包用 breaker.exec()
    llmBreaker = new CircuitBreaker({
      name: 'llm',
      failureThreshold: 3,
      cooldownMs: 60_000,
      onOpen: (state) => {
        currentLog.error({ state }, 'LLM 熔断器打开 — 后续 LLM 调用会立即 reject');
        // 走默认 notifier 通道发 critical（异步，不抛）
        getNotifier('feishu').send({
          title: '[探星] LLM 熔断',
          body: 'LLM 连续失败 ≥ 3 次，熔断器打开 60s。',
          level: 'critical',
        }).catch((err: unknown) => {
          currentLog.warn({ err: String(err) }, '熔断告警发送失败');
        });
      },
    });

    if (mode === 'sec_uid' || mode === 'both') {
      await updateStep(0, 'running');
      const result = await fetchViaSecUid(channels, knowledgeDir, opts, channelName, rateLimiter);
      comments.push(...result.comments);
      videosScanned += result.videos;
    }

    if (mode === 'keyword' || mode === 'both') {
      await updateStep(0, 'running');
      const result = await fetchViaKeyword(channels, knowledgeDir, opts, channelName, rateLimiter);
      comments.push(...result.comments);
      videosScanned += result.videos;
    }

    currentLog.info({ comments: comments.length, videos: videosScanned }, '收集评论');
    await updateStep(0, 'completed', { comments, videosScanned });
    stepDurations['reconnaissance'] = Date.now() - stepStart_recon;
  } catch (e) {
    stepDurations['reconnaissance'] = Date.now() - stepStart_recon;
    throw e;
  }

  // -------------------------------------------------------------------------
  // Step 2: analysis（预处理 + LLM 意图分析 + RAG 钩子）
  // Phase 0 PR 1：已包局部 try/catch，加 stepDurations
  // -------------------------------------------------------------------------
  await updateStep(1, 'running');
  const stepStart_analysis = Date.now();

  // 4. 预处理（去重 / 过滤）
  const filtered = preprocessComments(comments, channels);
  currentLog.info({ filtered: filtered.length }, '过滤评论');
  await updateStep(1, 'completed', { filtered: filtered.length });

  // 5. LLM 意图分析
  let leads: Lead[] = [];
  if (filtered.length > 0) {
    await updateStep(1, 'running');
    try {
      const { analyzeBatch } = await import('../modules/intent-analyzer/index.js');
      const { selectBestHookStyle } = await import('../modules/nurture-engine/feedback-loader.js');
      const systemPrompt = await loadSystemPrompt(loaded.promptsDir, profile);
      const userTpl = await readFileFromPrompts(loaded.promptsDir, 'intent-user.md');
      const llm = opts.injectLLM ?? (await import('../adapters/registry.js')).getLLM(profile.llm.provider);

      // Phase 2 #4:cost 埋点 —— 用 CostTracker 包装 LLM,累加 token/cost
      // cache 命中时 fetcher 不被调 → costTracker 自动不算 token（见 batch.ts: fetcher 闭包）
      const costTracker = new CostTracker(llm as ConstructorParameters<typeof CostTracker>[0], profile.llm.provider);

      // §3.11 回路 2：注入当前最优钩子风格（写到 lead.hook_style）
      // 优先级：weekly-insights.json（≥3 次测试的最优风格） > profile.hook_config.style > '像朋友推荐，不像销售'
      const bestStyle = await selectBestHookStyle();
      const hookStyle = bestStyle ?? profile.hook_config?.style ?? '像朋友推荐，不像销售';

      const batchCtx: import('../modules/intent-analyzer/batch.js').BatchContext = {
        profile,
        systemPrompt,
        userTplStr: userTpl,
        llm,
        threshold: 0.7,
        hookStyle,
        costTracker,
        modelName: profile.llm.model,
        // P0-A #3 修复：从 profile.llm.fallback 解析 fallback LLM 列表
        fallbackLLMs: await loadFallbackLLMs(profile),
        // P0-A #2 修复：把 LLM CircuitBreaker 注入 fetcher 闭包
        breaker: llmBreaker,
      };
      const batchSize = 10;
      for (let i = 0; i < filtered.length; i += batchSize) {
        const batch = filtered.slice(i, i + batchSize);
        // Phase 2 #4:记录每批实际大小(供未来 P50/P95 统计)
        costTracker.recordBatchSize(batch.length);
        const result = await analyzeBatch(batch, batchCtx);
        leads.push(...result.leads);
        result.rejected.forEach(r => errors.push(`[reject] ${r.cid}: ${r.reason}`));
      }
      // Phase 2 #4:把累积的 cost snapshot 挂到 opts,让 runDaily 外层 finally 块读
      // 不破坏 try/catch/finally 主结构,只新增一个属性
      (opts as { costSnapshot?: ReturnType<typeof costTracker.snapshot> }).costSnapshot = costTracker.snapshot();
      stepDurations['analysis'] = Date.now() - stepStart_analysis;
    } catch (e) {
      errors.push(`LLM 分析失败：${e instanceof Error ? e.message : String(e)}`);
      stepDurations['analysis'] = Date.now() - stepStart_analysis;
    }
    await updateStep(1, 'completed', { leadsCreated: leads.length });
  } else {
    // filtered.length === 0 → analysis 跳过，但也记 0 耗时
    stepDurations['analysis'] = Date.now() - stepStart_analysis;
  }
  currentLog.info({ leads: leads.length }, '生成 lead');

  // 5.5 RAG 钩子生成（§3.4 / §3.7 步骤 [1.6]）
  // 用知识库 + 反馈驱动风格替换 intent analyzer 生成的通用钩子
  if (leads.length > 0) {
    try {
      const { getEmbedding } = await import('../adapters/registry.js');
      // P0-E 修复：embedding provider 来自 profile.embedding.provider，默认 'qwen'
      // 如果用户只配了 OPENAI_API_KEY 会在 getEmbedding 里 fail-loud 报错
      const embeddingName = profile?.embedding?.provider ?? 'qwen';
      const embeddingProvider = getEmbedding(embeddingName);
      const { generateHook } = await import('../rag/hook-generator.js');

      let ragSuccess = 0;
      // Bug 54: dry-run 跳过 CRM 写回
      const ragCrm = opts.dryRun ? null : await createCRM(profile).catch(() => null);
      for (const lead of leads) {
        try {
          const ragOpts = {
            profile,
            promptsDir: loaded.promptsDir,
            knowledgeDir: loaded.knowledgeDir,
            dbPath: './data/vectors.db',
            embeddingProvider,
          };
          // reply 钩子（评论回复用）
          const replyResult = await generateHook(profile, lead, 'reply', ragOpts);
          lead.suggested_reply_hook = replyResult.hook;
          // dm 钩子（私信用）
          const dmResult = await generateHook(profile, lead, 'dm', ragOpts);
          lead.suggested_dm_hook = dmResult.hook;
          // Bug 54: 用返回的 lead（带 hook_style），并通过 crm.updateLeadFields 写回
          lead.hook_style = replyResult.hookStyle;
          if (ragCrm) {
            try {
              await ragCrm.updateLeadFields(lead.cid, { hook_style: replyResult.hookStyle });
            } catch (e) {
              currentLog.warn({ cid: lead.cid, err: String(e) }, 'hook_style 写回 CRM 失败');
            }
          }
          ragSuccess++;
        } catch {
          // 单个 lead RAG 失败不影响其他，保留 intent analyzer 的钩子
        }
      }
      currentLog.info({ success: ragSuccess, total: leads.length }, 'RAG 钩子生成');
    } catch {
      // embedding adapter 未注册 → 冷启动，跳过 RAG，保留 intent analyzer 的钩子
      currentLog.info('RAG 跳过（embedding adapter 未配置）');
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: sync（CRM 同步）
  // Phase 0 PR 1：已包局部 try/catch，加 stepDurations
  // -------------------------------------------------------------------------
  await updateStep(2, 'running');
  const stepStart_sync = Date.now();
  if (leads.length > 0 && !opts.dryRun) {
    try {
      const crm = await createCRM(profile);
      const syncResult = await crm.syncLeads(leads);
      currentLog.info({ synced: syncResult.synced, failed: syncResult.failed }, 'CRM 同步');
      if (syncResult.failed > 0) {
        syncResult.errors.forEach(e => errors.push(`[crm] ${e.cid}: ${e.error}`));
      }
      await updateStep(2, 'completed', syncResult);
      stepDurations['sync'] = Date.now() - stepStart_sync;
    } catch (e) {
      errors.push(`CRM 同步失败：${e instanceof Error ? e.message : String(e)}`);
      await updateStep(2, 'failed', undefined, String(e));
      stepDurations['sync'] = Date.now() - stepStart_sync;
    }
  } else {
    await updateStep(2, 'completed', { skipped: true });
    stepDurations['sync'] = Date.now() - stepStart_sync;
  }

  // -------------------------------------------------------------------------
  // Step 4: task_generation（生成引导任务）
  // Phase 0 PR 1：已包局部 try/catch，加 stepDurations
  // -------------------------------------------------------------------------
  await updateStep(3, 'running');
  const stepStart_taskgen = Date.now();
  let tasksCount = 0;
  let tasks: Task[] = [];
  if (!opts.dryRun) {
    try {
      const { generateDailyTasks } = opts.injectGenerateDailyTasks
        ? { generateDailyTasks: opts.injectGenerateDailyTasks }
        : await import('../modules/nurture-engine/index.js');
      const { loadLatestInsights } = await import('../modules/nurture-engine/feedback-loader.js');
      const crm = await createCRM(profile);
      const allLeads = await crm.listLeads({ has_open_task: true });
      const insights = await loadLatestInsights();
      tasks = generateDailyTasks(allLeads, { profile, conversion: conversion, dailyTaskLimit: opts.dailyTaskLimit, insights });
      tasksCount = tasks.length;
      const tasksPath = `./data/tmp/tasks-${date}.json`;
      const { mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(tasksPath), { recursive: true });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(tasksPath, JSON.stringify(tasks, null, 2), 'utf-8');
      currentLog.info({ count: tasksCount, path: tasksPath }, '生成任务');
      await updateStep(3, 'completed', { tasksCount });
      stepDurations['task_generation'] = Date.now() - stepStart_taskgen;
    } catch (e) {
      errors.push(`任务生成失败：${e instanceof Error ? e.message : String(e)}`);
      await updateStep(3, 'failed', undefined, String(e));
      stepDurations['task_generation'] = Date.now() - stepStart_taskgen;
    }
  } else {
    await updateStep(3, 'completed', { skipped: true });
    stepDurations['task_generation'] = Date.now() - stepStart_taskgen;
  }

  // -------------------------------------------------------------------------
  // Step 5: execution（7b 任务执行 + 7c 转化引擎）
  // Phase 0 PR 1：统一在 step 末尾记 stepDurations
  // Bug 18 修复：execution 块开始/结束必须 updateStep(4, ...)，否则 state.json 永远 pending
  // -------------------------------------------------------------------------
  await updateStep(4, 'running');
  let tasksExecuted = 0;
  let executionResults: ExecutionResult[] = [];
  const stepStart_exec = Date.now();
  let executionHadError = false;
  if (!opts.dryRun && tasks.length > 0 && opts.mode !== 'read-only') {
    try {
      const safety: SafetyConfig = loadSafetyConfig();
      const execCrm = await createCRM(profile);
      const execFn = opts.injectExecuteTasks ?? executeTasks;
      executionResults = await execFn(tasks, safety, { crm: execCrm });
      tasksExecuted = executionResults.length;
      currentLog.info({ executed: tasksExecuted, total: tasksCount }, '任务执行');
    } catch (e) {
      executionHadError = true;
      errors.push(`任务执行失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 7c. 转化引擎（§3.10）—— 加微后物料推送 + 转化日报
  if (!opts.dryRun) {
    try {
      const convCrm = await createCRM(profile);
      const { handleWechatAdded, generateDailyReport, pushDailyReport } = await import('../modules/conversion-engine/index.js');
      const convOpts = { profile, conversion, crm: convCrm };

      // 扫描「已加微」lead，推送物料
      const wechatLeads = await convCrm.listLeads({ status: ['已加微'] });
      for (const lead of wechatLeads) {
        try {
          await handleWechatAdded(lead, convOpts);
        } catch { /* 单 lead 失败不阻塞 */ }
      }

      // 生成并推送转化日报
      const report = await generateDailyReport(date, convOpts);
      await pushDailyReport(report);
      currentLog.info({
        new_leads: report.new_leads,
        new_wechat_added: report.new_wechat_added,
        new_bookings: report.new_bookings,
        new_deals_closed: report.new_deals_closed,
      }, '转化日报');
    } catch (e) {
      executionHadError = true;
      errors.push(`转化引擎失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  stepDurations['execution'] = Date.now() - stepStart_exec;

  // Bug 18 修复：必须收尾 updateStep，否则 state.json 永远 pending
  if (executionHadError) {
    await updateStep(4, 'failed', { executed: tasksExecuted }, errors[errors.length - 1] ?? 'execution failed');
  } else if (!opts.dryRun && tasks.length > 0 && opts.mode !== 'read-only') {
    await updateStep(4, 'completed', { executed: tasksExecuted });
  } else {
    // 跳过实际执行（dryRun / read-only / 无任务）也必须标 completed
    await updateStep(4, 'completed', { executed: 0, skipped: true });
  }

  // -------------------------------------------------------------------------
  // Step 5: notification
  // Phase 0 PR 1：已包局部 try/catch，加 stepDurations
  // -------------------------------------------------------------------------
  await updateStep(5, 'running');
  const stepStart_notif = Date.now();
  try {
    // P0-E 修复：notifier 来自 profile.notifier.default，默认 'console'
    const notifierName = profile?.notifier?.default ?? 'console';
    const notifier = getNotifier(notifierName);
    const modeNote = opts.mode === 'read-only' ? '\n🔒 模式：read-only（已跳过任务执行）' : '';
    await notifier.send({
      title: `✨ 探星早报 ${date}`,
      body: `📊 扫描：${videosScanned} 视频 / ${comments.length} 评论 / ${leads.length} 高意向\n🎯 待执行任务：${tasksCount} 条\n✅ 已执行：${tasksExecuted} 条${modeNote}`,
      level: 'info',
    });
    await updateStep(5, 'completed', { notified: true });
    stepDurations['notification'] = Date.now() - stepStart_notif;
  } catch (e) {
    errors.push(`通知失败：${e instanceof Error ? e.message : String(e)}`);
    await updateStep(5, 'failed', undefined, String(e));
    stepDurations['notification'] = Date.now() - stepStart_notif;
  }

  // -------------------------------------------------------------------------
  // Step 6: health_check (P0-F 修复：之前 step 6 永远 pending)
  // 跑一次轻量健康检查作为本次 run 的「关门检查」
  // -------------------------------------------------------------------------
  await updateStep(6, 'running');
  const stepStart_health = Date.now();
  try {
    const healthResult = await checkAll();
    await updateStep(6, 'completed', {
      status: healthResult.status,
      checksCount: healthResult.checks.length,
    });
    stepDurations['health_check'] = Date.now() - stepStart_health;
    if (healthResult.status === 'critical' || healthResult.status === 'error') {
      errors.push(`健康检查：${healthResult.summary}`);
    }
  } catch (e) {
    errors.push(`健康检查失败：${e instanceof Error ? e.message : String(e)}`);
    await updateStep(6, 'failed', undefined, String(e));
    stepDurations['health_check'] = Date.now() - stepStart_health;
  }

  const result: RunDailyResult = {
    date,
    videosScanned,
    commentsCollected: comments.length,
    leadsCreated: leads.length,
    tasksGenerated: tasksCount,
    tasksExecuted,
    duration_ms: Date.now() - t0,
    errors,
  };

  // Phase 0 PR 1：填 phase_counts（finally 块用来落 history）
  phaseCounts.videos_scanned = result.videosScanned;
  phaseCounts.comments_collected = result.commentsCollected;
  phaseCounts.leads_created = result.leadsCreated;
  phaseCounts.tasks_generated = result.tasksGenerated;
  phaseCounts.tasks_executed = result.tasksExecuted;

  await markComplete(true);
  currentLog.info({ duration_ms: result.duration_ms, errors: errors.length }, '完成');

  // P0-A #4 修复：feedback 回路接通 — applyOutcomeFeedback 把 outcomes.jsonl
  // 里的转化/流失数据写回 channels.yaml 的 personas[].value_score。
  // 失败时仅 log warn，不阻塞主流程（与 feedback-applier 自身 fail-loud 设计一致）。
  if (!opts.dryRun) {
    try {
      const { applyOutcomeFeedback } = await import('../modules/feedback-applier/index.js');
      const fbResult = await applyOutcomeFeedback({ businessDir: opts.businessDir });
      currentLog.info({
        loaded: fbResult.outcomes_loaded,
        updated: fbResult.personas_updated,
        skipped: fbResult.skipped,
      }, '反馈回路：persona value_score 已更新');
    } catch (e) {
      currentLog.warn({ err: e instanceof Error ? e.message : String(e) }, 'feedback-applier 失败（不影响主流程）');
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 路径 A：sec_uid 模式（推荐）
// ---------------------------------------------------------------------------

async function fetchViaSecUid(
  channels: import('../core/types.js').ChannelsConfig,
  _knowledgeDir: string,
  _opts: RunDailyOptions,
  channelName: string,
  rateLimiter: RateLimiter,
): Promise<{ comments: Comment[]; videos: number }> {
  const secUids = channels.target_sec_uids?.sec_uids ?? [];
  const userLimit = channels.target_sec_uids?.user_videos_limit ?? 20;
  const commentLimit = channels.target_sec_uids?.comment_limit ?? 10;

  if (secUids.length === 0) {
    currentLog.warn('sec_uid 模式但 channels.yaml 里 sec_uids 为空，跳过');
    return { comments: [], videos: 0 };
  }

  // P0-E 修复：channel 名由调用方传入（来自 profile.channel.name）
  const channel = getChannel(channelName);
  const comments: Comment[] = [];
  let videos = 0;

  for (const secUid of secUids) {
    try {
      // P0-A #1 修复：channel.getUserVideos 之前 wait（节流）
      await rateLimiter.waitForUserVideos();
      const userVideos = await channel.getUserVideos(secUid, {
        limit: userLimit,
        withComments: true,
        commentLimit,
      });
      videos += userVideos.length;
      for (const v of userVideos) {
        for (const c of v.top_comments) {
          comments.push({
            cid: c.cid,
            aweme_id: v.aweme_id,
            video_url: `https://www.douyin.com/video/${v.aweme_id}`,
            video_desc: v.title,
            keyword: secUid,
            text: c.text,
            user: c.user,
            digg_count: c.digg_count,
            create_time: String(c.create_time),
            reply_count: c.reply_count,
          });
        }
      }
    } catch (e) {
      currentLog.warn({ err: e, secUid }, 'KOL 拉取失败');
    }
  }
  return { comments, videos };
}

// ---------------------------------------------------------------------------
// 路径 B：keyword 模式
// ---------------------------------------------------------------------------

async function fetchViaKeyword(
  channels: import('../core/types.js').ChannelsConfig,
  _knowledgeDir: string,
  _opts: RunDailyOptions,
  channelName: string,
  rateLimiter: RateLimiter,
): Promise<{ comments: Comment[]; videos: number }> {
  const keywords = channels.search?.keywords ?? {};
  const limit = channels.search?.limit_per_keyword ?? 10;

  if (Object.keys(keywords).length === 0) {
    return { comments: [], videos: 0 };
  }

  // P0-E 修复：channel 名由调用方传入（来自 profile.channel.name）
  const channel = getChannel(channelName);
  const comments: Comment[] = [];
  const videos: import('../core/types.js').Video[] = [];

  for (const [kw, _weight] of Object.entries(keywords)) {
    try {
      // P0-A #1 修复：channel.search 之前 wait（节流）
      await rateLimiter.waitForSearch();
      const result = await channel.search({ keywords: [kw], limit });
      videos.push(...result);
    } catch (e) {
      currentLog.warn({ err: e, keyword: kw }, '关键词搜索失败');
    }
  }

  // 搜到视频后，拉真实评论（不再是视频标题当评论）
  const douyinChannel = channel as import('../adapters/channel/douyin.js').DouyinChannel;
  let commentCount = 0;

  for (const v of videos) {
    if (!v.aweme_id) continue;
    try {
      // P0-A #1 修复：拉评论之前 wait（节流）
      await rateLimiter.waitForComment();
      const videoComments = await douyinChannel.getVideoComments(v.aweme_id, 10);
      for (const c of videoComments) {
        comments.push({
          cid: `${v.aweme_id}-${c.nickname}-${commentCount++}`,
          aweme_id: v.aweme_id,
          video_url: v.url,
          video_desc: v.desc,
          keyword: v.desc?.slice(0, 20) ?? '',
          text: c.text,
          user: { nickname: c.nickname, uid: c.uid, follower_count: 0, signature: '' },
          digg_count: c.digg_count,
          create_time: '',
          reply_count: 0,
        });
      }
      // 如果该视频没有评论，用视频描述作为 fallback
      if (videoComments.length === 0) {
        comments.push({
          cid: `${v.aweme_id}-desc`,
          aweme_id: v.aweme_id,
          video_url: v.url,
          video_desc: v.desc,
          keyword: 'video_desc_only',
          text: v.desc,
          user: { nickname: v.author, uid: '', follower_count: 0, signature: '' },
          digg_count: v.likes,
          create_time: '',
          reply_count: 0,
        });
      }
    } catch (e) {
      currentLog.warn({ err: e, aweme_id: v.aweme_id }, '拉评论失败，用视频描述 fallback');
      comments.push({
        cid: `${v.aweme_id}-desc-fallback`,
        aweme_id: v.aweme_id,
        video_url: v.url,
        video_desc: v.desc,
        keyword: 'video_desc_fallback',
        text: v.desc,
        user: { nickname: v.author, uid: '', follower_count: 0, signature: '' },
        digg_count: v.likes,
        create_time: '',
        reply_count: 0,
      });
    }
  }
  return { comments, videos: videos.length };
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function preprocessComments(comments: Comment[], channels: import('../core/types.js').ChannelsConfig): Comment[] {
  const filters = channels.comment_filters ?? {};
  const minLength = filters.min_length ?? 4;

  const seen = new Set<string>();
  const out: Comment[] = [];

  for (const c of comments) {
    if (seen.has(c.cid)) continue;
    seen.add(c.cid);
    if (!c.text || c.text.length < minLength) continue;
    if (filters.exclude_emoji_only !== false && isEmojiOnly(c.text)) continue;
    if (filters.exclude_punctuation_only !== false && isPunctuationOnly(c.text)) continue;
    out.push(c);
  }
  return out;
}

function isEmojiOnly(s: string): boolean {
  return /^[\p{Emoji}\s]+$/u.test(s);
}

function isPunctuationOnly(s: string): boolean {
  return /^[\p{P}\s]+$/u.test(s);
}

async function loadSystemPrompt(promptsDir: string, profile: import('../core/types.js').BusinessProfile): Promise<string> {
  const raw = await readFileFromPrompts(promptsDir, 'intent-system.md');
  return raw
    .replace(/\{\{business\.name\}\}/g, profile.business.name)
    .replace(/\{\{business\.value_prop\}\}/g, profile.business.value_prop);
}

async function readFileFromPrompts(promptsDir: string, filename: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const path = join(promptsDir, filename);
  if (existsSync(path)) {
    return readFile(path, 'utf-8');
  }
  return '';
}

async function createCRM(profile: import('../core/types.js').BusinessProfile) {
  const { getCRM } = await import('../adapters/registry.js');
  return getCRM(profile.crm.type);
}

// ---------------------------------------------------------------------------
// Phase 0 PR 2（Task 2.2）：notifier 告警 helper
// ---------------------------------------------------------------------------

/**
 * 加载业务 profile 并解析 notifier 列表。
 * profile 加载失败时返回 []，告警降级为静默（不阻塞主流程）。
 * 测试可通过 opts.injectNotifiers / opts.injectResolveNotifiers 覆盖。
 */
async function loadAndResolveNotifiers(opts: RunDailyOptions): Promise<Notifier[]> {
  try {
    const loaded = await loadBusinessProfile(opts.businessDir);
    return (opts.injectResolveNotifiers ?? defaultResolveNotifiers)(loaded.profile);
  } catch (e) {
    currentLog.warn({ err: e instanceof Error ? e.message : String(e) }, '加载 profile 失败，告警跳过');
    return [];
  }
}

/**
 * P0-A #3 修复：从 profile.llm.fallback 解析出 fallback LLM 实例列表
 * 主 LLM 失败时按此顺序尝试。fallback provider 未注册时跳过并 log warn。
 */
async function loadFallbackLLMs(
  profile: import('../core/types.js').BusinessProfile,
): Promise<Array<{ name: string; llm: { complete(prompt: string): Promise<string> } }>> {
  if (!profile.llm.fallback || profile.llm.fallback.length === 0) return [];
  const { getLLM } = await import('../adapters/registry.js');
  const out: Array<{ name: string; llm: { complete(prompt: string): Promise<string> } }> = [];
  for (const fb of profile.llm.fallback) {
    try {
      const llm = getLLM(fb.provider);
      out.push({ name: `${fb.provider}/${fb.model}`, llm });
    } catch (e) {
      currentLog.warn({ provider: fb.provider, err: String(e) }, 'fallback LLM 未注册，跳过');
    }
  }
  return out;
}

/**
 * 发送 notifier 消息，10s 超时（Promise.race），不抛异常到外层。
 * 关键：finally 块调用时绝不能让 notifier 失败/超时 throw 到外层。
 */
async function sendWithTimeout(n: Notifier, message: Parameters<Notifier['send']>[0]): Promise<void> {
  try {
    await Promise.race([
      n.send(message),
      new Promise((_, reject) => setTimeout(() => reject(new Error('notifier.send timeout')), 10_000)),
    ]);
  } catch (e) {
    currentLog.error(
      { notifier: n.name, err: e instanceof Error ? e.message : String(e) },
      'notifier.send 失败/超时',
    );
    // 绝不抛出 —— caller 可能在 finally 块，throw 会破坏 finally 语义
  }
}

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

export async function runCLI(args: string[]): Promise<void> {
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const businessDir = get('--business');
  if (!businessDir) {
    console.error('用法: run --business <dir> [--dry-run] [--skip-llm]');
    process.exit(1);
  }
  await runDaily({
    businessDir,
    dryRun: args.includes('--dry-run'),
    skipLLM: args.includes('--skip-llm'),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
