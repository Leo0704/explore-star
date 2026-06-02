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

import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getChannel, getNotifier } from '../adapters/registry.js';
import type { Comment, Lead, Task } from '../core/types.js';
import { executeTasks, loadSafetyConfig, type ExecutionResult, type SafetyConfig } from '../modules/task-executor/index.js';
import { loadState, updateStep, markComplete, resetForNewDay } from './state.js';
import { logger } from '../core/logger.js';
import { appendRunHistory, type RunHistoryEntry } from './run-history.js';

const log = logger.child({ module: 'run-daily' });

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
 */
export class LoginRequiredError extends Error {
  readonly code = 'LOGIN_REQUIRED' as const;
  constructor(message = '检测到登录态失效') {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

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

  log.info({ business: opts.businessDir, date, mode: opts.mode ?? 'full' }, '启动');

  // 检查是否新的一天，如果是则重置状态
  const state = await loadState();
  if (state.date !== date) {
    await resetForNewDay();
  }

  const historyPath = opts.injectHistoryPath ?? './data/run_history.jsonl';
  const writeHistory = opts.injectWriteHistory !== false;
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
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
      await handleLoginRequired(opts.businessDir);
    } else {
      exitReason = 'failed';
    }
    throw e;
  } finally {
    if (writeHistory) {
      try {
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
        });
      } catch (historyErr) {
        log.error({ err: historyErr, runId }, '写 run_history 失败（不阻塞主流程）');
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
  try {
    // 1. 加载业务配置
    await updateStep(0, 'running');
    loaded = await loadBusinessProfile(opts.businessDir);
    profile = loaded.profile;
    channels = loaded.channels;
    conversion = loaded.conversion;
    knowledgeDir = loaded.knowledgeDir;
    await updateStep(0, 'completed', { mode: channels.source?.mode ?? 'sec_uid' });

    // 2. 注册所有内置 adapter
    await registerBuiltins();

    // 2.5 R1：登录态前置检查 —— 未登录则 throw LoginRequiredError，外层会飞书告警 + 停手
    // 测试可通过 opts.injectChannel 注入 mock channel
    await assertLoggedIn(opts.injectChannel ?? getChannel('douyin'));

    // 3. 选数据源模式
    const mode = channels.source?.mode ?? 'sec_uid';

    // 3.5 keyword/both 模式：用 LLM 从业务画像自动生成搜索关键词
    if (mode === 'keyword' || mode === 'both') {
      const llmForKw = opts.injectLLM
        ? opts.injectLLM
        : (await import('../adapters/registry.js')).getLLM(profile.llm.provider);
      const { generateSearchKeywords } = await import('../modules/keyword-generator.js');
      const generated = await generateSearchKeywords(profile, llmForKw);
      if (Object.keys(generated).length > 0) {
        channels.search = {
          ...channels.search,
          keywords: { ...channels.search?.keywords, ...generated },
        };
        log.info({ keywords: Object.keys(generated) }, '合并 LLM 生成的关键词');
      }
    }

    if (mode === 'sec_uid' || mode === 'both') {
      await updateStep(0, 'running');
      const result = await fetchViaSecUid(channels, knowledgeDir, opts);
      comments.push(...result.comments);
      videosScanned += result.videos;
    }

    if (mode === 'keyword' || mode === 'both') {
      await updateStep(0, 'running');
      const result = await fetchViaKeyword(channels, knowledgeDir, opts);
      comments.push(...result.comments);
      videosScanned += result.videos;
    }

    log.info({ comments: comments.length, videos: videosScanned }, '收集评论');
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
  log.info({ filtered: filtered.length }, '过滤评论');
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
      };
      const batchSize = 10;
      for (let i = 0; i < filtered.length; i += batchSize) {
        const batch = filtered.slice(i, i + batchSize);
        const result = await analyzeBatch(batch, batchCtx);
        leads.push(...result.leads);
        result.rejected.forEach(r => errors.push(`[reject] ${r.cid}: ${r.reason}`));
      }
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
  log.info({ leads: leads.length }, '生成 lead');

  // 5.5 RAG 钩子生成（§3.4 / §3.7 步骤 [1.6]）
  // 用知识库 + 反馈驱动风格替换 intent analyzer 生成的通用钩子
  if (leads.length > 0) {
    try {
      const { getEmbedding } = await import('../adapters/registry.js');
      // 默认用国产通义（Q1 切换）；如果用户只配了 OPENAI_API_KEY 会在 getEmbedding 里 fail-loud 报错
      const embeddingProvider = getEmbedding('qwen');
      const { generateHook } = await import('../rag/hook-generator.js');

      let ragSuccess = 0;
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
          lead.hook_style = replyResult.hookStyle;
          ragSuccess++;
        } catch {
          // 单个 lead RAG 失败不影响其他，保留 intent analyzer 的钩子
        }
      }
      log.info({ success: ragSuccess, total: leads.length }, 'RAG 钩子生成');
    } catch {
      // embedding adapter 未注册 → 冷启动，跳过 RAG，保留 intent analyzer 的钩子
      log.info('RAG 跳过（embedding adapter 未配置）');
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
      log.info({ synced: syncResult.synced, failed: syncResult.failed }, 'CRM 同步');
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
      log.info({ count: tasksCount, path: tasksPath }, '生成任务');
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
  // -------------------------------------------------------------------------
  let tasksExecuted = 0;
  let executionResults: ExecutionResult[] = [];
  const stepStart_exec = Date.now();
  if (!opts.dryRun && tasks.length > 0 && opts.mode !== 'read-only') {
    try {
      const safety: SafetyConfig = loadSafetyConfig();
      const execCrm = await createCRM(profile);
      const execFn = opts.injectExecuteTasks ?? executeTasks;
      executionResults = await execFn(tasks, safety, { crm: execCrm });
      tasksExecuted = executionResults.length;
      log.info({ executed: tasksExecuted, total: tasksCount }, '任务执行');
    } catch (e) {
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
      log.info({
        new_leads: report.new_leads,
        new_wechat_added: report.new_wechat_added,
        new_bookings: report.new_bookings,
        new_deals_closed: report.new_deals_closed,
      }, '转化日报');
    } catch (e) {
      errors.push(`转化引擎失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  stepDurations['execution'] = Date.now() - stepStart_exec;

  // -------------------------------------------------------------------------
  // Step 6: notification
  // Phase 0 PR 1：已包局部 try/catch，加 stepDurations
  // -------------------------------------------------------------------------
  await updateStep(5, 'running');
  const stepStart_notif = Date.now();
  try {
    const notifier = getNotifier('console');
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
  log.info({ duration_ms: result.duration_ms, errors: errors.length }, '完成');
  return result;
}

// ---------------------------------------------------------------------------
// 路径 A：sec_uid 模式（推荐）
// ---------------------------------------------------------------------------

async function fetchViaSecUid(
  channels: import('../core/types.js').ChannelsConfig,
  _knowledgeDir: string,
  _opts: RunDailyOptions,
): Promise<{ comments: Comment[]; videos: number }> {
  const secUids = channels.target_sec_uids?.sec_uids ?? [];
  const userLimit = channels.target_sec_uids?.user_videos_limit ?? 20;
  const commentLimit = channels.target_sec_uids?.comment_limit ?? 10;

  if (secUids.length === 0) {
    log.warn('sec_uid 模式但 channels.yaml 里 sec_uids 为空，跳过');
    return { comments: [], videos: 0 };
  }

  const channel = getChannel('douyin');
  const comments: Comment[] = [];
  let videos = 0;

  for (const secUid of secUids) {
    try {
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
      log.warn({ err: e, secUid }, 'KOL 拉取失败');
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
): Promise<{ comments: Comment[]; videos: number }> {
  const keywords = channels.search?.keywords ?? {};
  const limit = channels.search?.limit_per_keyword ?? 10;

  if (Object.keys(keywords).length === 0) {
    return { comments: [], videos: 0 };
  }

  const channel = getChannel('douyin');
  const comments: Comment[] = [];
  const videos: import('../core/types.js').Video[] = [];

  for (const [kw, _weight] of Object.entries(keywords)) {
    try {
      const result = await channel.search({ keywords: [kw], limit });
      videos.push(...result);
    } catch (e) {
      log.warn({ err: e, keyword: kw }, '关键词搜索失败');
    }
  }

  // 搜到视频后，拉真实评论（不再是视频标题当评论）
  const douyinChannel = channel as import('../adapters/channel/douyin.js').DouyinChannel;
  let commentCount = 0;

  for (const v of videos) {
    if (!v.aweme_id) continue;
    try {
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
      log.warn({ err: e, aweme_id: v.aweme_id }, '拉评论失败，用视频描述 fallback');
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
