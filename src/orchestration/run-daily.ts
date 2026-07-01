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
import { getCommentStore, type StoredComment } from '../core/comment-store.js';

const log = logger.child({ module: 'run-daily' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentLog: any = log;

export interface RunDailyOptions {
  businessDir: string;
  dryRun?: boolean;
  skipLLM?: boolean;
  dailyTaskLimit?: number;
  videoLimit?: number;
  injectLLM?: { complete(p: string): Promise<string> };
  step?: number;
  mode?: 'full' | 'read-only';
  injectChannel?: import('../core/types.js').ChannelAdapter;
  injectExecuteTasks?: typeof import('../modules/task-executor/index.js').executeTasks;
  injectGenerateDailyTasks?: typeof import('../modules/nurture-engine/index.js').generateDailyTasks;
  injectHistoryPath?: string;
  injectWriteHistory?: boolean;
  injectNotifiers?: Notifier[];
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

import { LoginRequiredError } from '../core/channel-errors.js';
export { LoginRequiredError };

async function assertLoggedIn(channel: import('../core/types.js').ChannelAdapter): Promise<void> {
  const result = await channel.ping();
  if (!result.loggedIn) {
    throw new LoginRequiredError('channel.ping() 返回 loggedIn=false');
  }
}

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
    const consoleNotifier = getNotifier('console');
    await consoleNotifier.send({ ...message, title: `[fallback:console] ${message.title}` });
  }
}

export async function runDaily(opts: RunDailyOptions): Promise<RunDailyResult> {
  const t0 = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

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

async function runDailyBody(
  opts: RunDailyOptions,
  t0: number,
  date: string,
  errors: string[],
  stepDurations: Record<string, number>,
  phaseCounts: RunHistoryEntry['phase_counts'],
): Promise<RunDailyResult> {
  const stepStart_recon = Date.now();
  let loaded: Awaited<ReturnType<typeof loadBusinessProfile>> | null = null;
  let profile: import('../core/types.js').BusinessProfile | null = null;
  let channels: import('../core/types.js').ChannelsConfig | null = null;
  let conversion: import('../core/types.js').ConversionConfig | null = null;
  let knowledgeDir: string | null = null;
  let comments: Comment[] = [];
  let videosScanned = 0;
  let rateLimiter: RateLimiter | null = null;
  let llmBreaker: CircuitBreaker | null = null;

  const startStep = opts.step ?? 0;

  // 步骤 0：侦察阶段（采集评论）
  if (startStep <= 0) {
    try {
      await updateStep(0, 'running');
      loaded = await loadBusinessProfile(opts.businessDir);
      profile = loaded.profile;
      channels = loaded.channels;
      conversion = loaded.conversion;
      knowledgeDir = loaded.knowledgeDir;
      setChannelConfigPath(join(opts.businessDir, 'channels.yaml'));
      await updateStep(0, 'completed', { mode: channels.source?.mode ?? 'sec_uid' });

      await registerBuiltins();

      const channelName = profile?.channel?.name ?? 'douyin';
      await assertLoggedIn(opts.injectChannel ?? getChannel(channelName));

      const mode = channels.source?.mode ?? 'sec_uid';

      if (mode === 'keyword' || mode === 'both') {
        const llmForKw = opts.injectLLM
          ? opts.injectLLM
          : (await import('../adapters/registry.js')).getLLM(profile.llm.provider);
        const { generateSearchKeywords, writebackGeneratedKeywords } = await import('../modules/keyword-generator.js');
        const generated = await generateSearchKeywords(profile, llmForKw);
        if (Object.keys(generated).length === 0) {
        } else {
          channels.search = {
            ...channels.search,
            keywords: { ...channels.search?.keywords, ...generated },
          };
          currentLog.info({ keywords: Object.keys(generated) }, '合并 LLM 生成的关键词');
          await writebackGeneratedKeywords(join(opts.businessDir, 'channels.yaml'), generated);
        }
      }

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

      llmBreaker = new CircuitBreaker({
        name: 'llm',
        failureThreshold: 3,
        cooldownMs: 60_000,
        onOpen: (state) => {
          currentLog.error({ state }, 'LLM 熔断器打开 — 后续 LLM 调用会立即 reject');
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

      // 保存评论到数据库，去重
      const commentStore = getCommentStore();
      const storedComments: StoredComment[] = comments.map(c => ({
        aweme_id: c.aweme_id,
        comment_text: c.text,
        nickname: c.user.nickname,
        video_url: c.video_url,
        video_desc: c.video_desc,
        keyword: c.keyword,
      }));
      const newCommentsCount = commentStore.saveComments(storedComments);
      const stats = commentStore.getStats();
      currentLog.info({
        comments: comments.length,
        newComments: newCommentsCount,
        totalInDb: stats.total,
        pendingAnalysis: stats.pending,
        videos: videosScanned,
      }, '收集评论并保存到数据库');
      await updateStep(0, 'completed', { comments, videosScanned });
      stepDurations['reconnaissance'] = Date.now() - stepStart_recon;
    } catch (e) {
      stepDurations['reconnaissance'] = Date.now() - stepStart_recon;
      throw e;
    }
  } else {
    // 跳过侦察阶段，加载配置
    loaded = await loadBusinessProfile(opts.businessDir);
    profile = loaded.profile;
    channels = loaded.channels;
    conversion = loaded.conversion;
    knowledgeDir = loaded.knowledgeDir;
    setChannelConfigPath(join(opts.businessDir, 'channels.yaml'));
    await registerBuiltins();
    currentLog.info({ startStep }, '跳过侦察阶段，从数据库加载评论');
    stepDurations['reconnaissance'] = 0;
  }

  await updateStep(1, 'running');
  const stepStart_analysis = Date.now();

  // 从数据库获取未分析的评论
  const commentStore = getCommentStore();
  const unanalyzedComments = commentStore.getUnanalyzedComments(1000);
  currentLog.info({
    unanalyzed: unanalyzedComments.length,
    totalInDb: commentStore.getStats().total,
  }, '从数据库获取未分析评论');

  // 将 StoredComment 转换为 Comment 格式
  const commentsToAnalyze: Comment[] = unanalyzedComments.map(c => ({
    cid: `${c.aweme_id}-${c.nickname}-${c.id}`,
    aweme_id: c.aweme_id,
    video_url: c.video_url,
    video_desc: c.video_desc,
    keyword: c.keyword,
    text: c.comment_text,
    user: { nickname: c.nickname, uid: '', follower_count: 0, signature: '' },
    digg_count: 0,
    create_time: '',
    reply_count: 0,
  }));

  const filtered = preprocessComments(commentsToAnalyze, channels);
  currentLog.info({ filtered: filtered.length }, '过滤评论');
  await updateStep(1, 'completed', { filtered: filtered.length });

  let leads: Lead[] = [];
  if (filtered.length > 0) {
    await updateStep(1, 'running');
    try {
      const { analyzeBatch } = await import('../modules/intent-analyzer/index.js');
      const { selectBestHookStyle } = await import('../modules/nurture-engine/feedback-loader.js');
      const systemPrompt = await loadSystemPrompt(loaded.promptsDir, profile);
      const userTpl = await readFileFromPrompts(loaded.promptsDir, 'intent-user.md');
      const llm = opts.injectLLM ?? (await import('../adapters/registry.js')).getLLM(profile.llm.provider);

      const costTracker = new CostTracker(llm as ConstructorParameters<typeof CostTracker>[0], profile.llm.provider);

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
        fallbackLLMs: await loadFallbackLLMs(profile),
        breaker: llmBreaker ?? undefined,
      };
      const batchSize = 10;
      const analyzedIds: number[] = [];
      for (let i = 0; i < filtered.length; i += batchSize) {
        const batch = filtered.slice(i, i + batchSize);
        costTracker.recordBatchSize(batch.length);
        const result = await analyzeBatch(batch, batchCtx);
        leads.push(...result.leads);
        result.rejected.forEach(r => errors.push(`[reject] ${r.cid}: ${r.reason}`));

        // 标记已分析的评论
        for (const comment of batch) {
          const storedComment = unanalyzedComments.find(c =>
            `${c.aweme_id}-${c.nickname}-${c.id}` === comment.cid
          );
          if (storedComment?.id) {
            analyzedIds.push(storedComment.id);
          }
        }
      }

      // 批量标记为已分析
      if (analyzedIds.length > 0) {
        commentStore.markManyAnalyzed(analyzedIds, 'success');
        currentLog.info({ analyzed: analyzedIds.length }, '已标记评论为已分析');
      }

      (opts as { costSnapshot?: ReturnType<typeof costTracker.snapshot> }).costSnapshot = costTracker.snapshot();
      stepDurations['analysis'] = Date.now() - stepStart_analysis;
    } catch (e) {
      errors.push(`LLM 分析失败：${e instanceof Error ? e.message : String(e)}`);
      stepDurations['analysis'] = Date.now() - stepStart_analysis;
    }
    await updateStep(1, 'completed', { leadsCreated: leads.length });
  } else {
    stepDurations['analysis'] = Date.now() - stepStart_analysis;
  }
  currentLog.info({ leads: leads.length }, '生成 lead');

  if (leads.length > 0) {
    try {
      const { getEmbedding } = await import('../adapters/registry.js');
      const embeddingName = profile?.embedding?.provider ?? 'qwen';
      const embeddingProvider = getEmbedding(embeddingName);
      const { generateHook } = await import('../rag/hook-generator.js');

      let ragSuccess = 0;
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
          const replyResult = await generateHook(profile, lead, 'reply', ragOpts);
          lead.suggested_reply_hook = replyResult.hook;
          const dmResult = await generateHook(profile, lead, 'dm', ragOpts);
          lead.suggested_dm_hook = dmResult.hook;
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
        }
      }
      currentLog.info({ success: ragSuccess, total: leads.length }, 'RAG 钩子生成');
    } catch {
      currentLog.info('RAG 跳过（embedding adapter 未配置）');
    }
  }

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

  if (!opts.dryRun) {
    try {
      const convCrm = await createCRM(profile);
      const { handleWechatAdded, generateDailyReport, pushDailyReport } = await import('../modules/conversion-engine/index.js');
      const convOpts = { profile, conversion, crm: convCrm };

      const wechatLeads = await convCrm.listLeads({ status: ['已加微'] });
      for (const lead of wechatLeads) {
        try {
          await handleWechatAdded(lead, convOpts);
        } catch { }
      }

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

  if (executionHadError) {
    await updateStep(4, 'failed', { executed: tasksExecuted }, errors[errors.length - 1] ?? 'execution failed');
  } else if (!opts.dryRun && tasks.length > 0 && opts.mode !== 'read-only') {
    await updateStep(4, 'completed', { executed: tasksExecuted });
  } else {
    await updateStep(4, 'completed', { executed: 0, skipped: true });
  }

  await updateStep(5, 'running');
  const stepStart_notif = Date.now();
  try {
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

  phaseCounts.videos_scanned = result.videosScanned;
  phaseCounts.comments_collected = result.commentsCollected;
  phaseCounts.leads_created = result.leadsCreated;
  phaseCounts.tasks_generated = result.tasksGenerated;
  phaseCounts.tasks_executed = result.tasksExecuted;

  await markComplete(true);
  currentLog.info({ duration_ms: result.duration_ms, errors: errors.length }, '完成');

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

  const channel = getChannel(channelName);
  const comments: Comment[] = [];
  let videos = 0;

  for (const secUid of secUids) {
    try {
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

  const channel = getChannel(channelName);
  const comments: Comment[] = [];
  const videos: import('../core/types.js').Video[] = [];

  for (const [kw, _weight] of Object.entries(keywords)) {
    try {
      await rateLimiter.waitForSearch();
      const result = await channel.search({ keywords: [kw], limit });
      videos.push(...result);
    } catch (e) {
      currentLog.warn({ err: e, keyword: kw }, '关键词搜索失败');
    }
  }

  const douyinChannel = channel as import('../adapters/channel/douyin.js').DouyinChannel;
  let commentCount = 0;

  for (const v of videos) {
    if (!v.aweme_id) continue;
    try {
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

async function loadAndResolveNotifiers(opts: RunDailyOptions): Promise<Notifier[]> {
  try {
    const loaded = await loadBusinessProfile(opts.businessDir);
    return (opts.injectResolveNotifiers ?? defaultResolveNotifiers)(loaded.profile);
  } catch (e) {
    currentLog.warn({ err: e instanceof Error ? e.message : String(e) }, '加载 profile 失败，告警跳过');
    return [];
  }
}

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
  }
}

export async function runCLI(args: string[]): Promise<void> {
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const businessDir = get('--business');
  if (!businessDir) {
    console.error('用法: run --business <dir> [--dry-run] [--skip-llm] [--step <0-6>]');
    console.error('');
    console.error('步骤说明:');
    console.error('  --step 0: 侦察阶段（采集评论）- 默认');
    console.error('  --step 1: 分析阶段（LLM 分析）');
    console.error('  --step 2: CRM 同步');
    console.error('  --step 3: 任务生成');
    console.error('  --step 4: 任务执行');
    console.error('  --step 5: 通知');
    console.error('  --step 6: 健康检查');
    process.exit(1);
  }
  const stepStr = get('--step');
  const step = stepStr ? parseInt(stepStr, 10) : 0;
  if (isNaN(step) || step < 0 || step > 6) {
    console.error('错误: --step 必须是 0-6 之间的数字');
    process.exit(1);
  }
  await runDaily({
    businessDir,
    dryRun: args.includes('--dry-run'),
    skipLLM: args.includes('--skip-llm'),
    step,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
