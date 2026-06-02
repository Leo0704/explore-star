/**
 * 每日编排器（§3.7）
 *
 * V1.4 增强：
 *   - 串联 7 步（侦察→分析→同步→任务→执行→通知→健康检查）
 *   - 支持断点续传（state.ts）
 *   - 支持 --dry-run / --skip-llm / --step
 */

import { existsSync } from 'node:fs';

import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getChannel, getNotifier } from '../adapters/registry.js';
import type { Comment, Lead, Task } from '../core/types.js';
import { executeTasks, loadSafetyConfig, type ExecutionResult, type SafetyConfig } from '../modules/task-executor/index.js';
import { loadState, updateStep, markComplete, resetForNewDay } from './state.js';

export interface RunDailyOptions {
  businessDir: string;
  dryRun?: boolean;
  skipLLM?: boolean;
  dailyTaskLimit?: number;
  videoLimit?: number;
  injectLLM?: { complete(p: string): Promise<string> };
  /** 只跑特定步骤（0-6） */
  step?: number;
  /** 测试注入：覆盖 executeTasks（避免需要真浏览器） */
  injectExecuteTasks?: typeof import('../modules/task-executor/index.js').executeTasks;
  /** 测试注入：覆盖 generateDailyTasks */
  injectGenerateDailyTasks?: typeof import('../modules/nurture-engine/index.js').generateDailyTasks;
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

export async function runDaily(opts: RunDailyOptions): Promise<RunDailyResult> {
  const t0 = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

  console.log(`[run-daily] 启动 | business=${opts.businessDir} | date=${date}`);

  // 检查是否新的一天，如果是则重置状态
  const state = await loadState();
  if (state.date !== date) {
    await resetForNewDay();
  }

  // 1. 加载业务配置
  await updateStep(0, 'running');
  const loaded = await loadBusinessProfile(opts.businessDir);
  const { profile, channels, conversion, knowledgeDir } = loaded;
  await updateStep(0, 'completed', { mode: channels.source?.mode ?? 'sec_uid' });

  // 2. 注册所有内置 adapter
  await registerBuiltins();

  // 3. 选数据源模式
  const mode = channels.source?.mode ?? 'sec_uid';

  let comments: Comment[] = [];
  let videosScanned = 0;

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

  console.log(`[run-daily] 收集到 ${comments.length} 条评论 from ${videosScanned} 个视频`);
  await updateStep(0, 'completed', { comments, videosScanned });

  // 4. 预处理（去重 / 过滤）
  await updateStep(1, 'running');
  const filtered = preprocessComments(comments, channels);
  console.log(`[run-daily] 过滤后 ${filtered.length} 条`);
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
    } catch (e) {
      errors.push(`LLM 分析失败：${e instanceof Error ? e.message : String(e)}`);
    }
    await updateStep(1, 'completed', { leadsCreated: leads.length });
  }
  console.log(`[run-daily] 生成 ${leads.length} 个高意向 lead`);

  // 5.5 RAG 钩子生成（§3.4 / §3.7 步骤 [1.6]）
  // 用知识库 + 反馈驱动风格替换 intent analyzer 生成的通用钩子
  if (leads.length > 0) {
    try {
      const { getEmbedding } = await import('../adapters/registry.js');
      const embeddingProvider = getEmbedding('openai');
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
      console.log(`[run-daily] RAG 钩子生成：${ragSuccess}/${leads.length} 成功`);
    } catch {
      // embedding adapter 未注册 → 冷启动，跳过 RAG，保留 intent analyzer 的钩子
      console.log(`[run-daily] RAG 跳过（embedding adapter 未配置）`);
    }
  }

  // 6. CRM 同步
  await updateStep(2, 'running');
  if (leads.length > 0 && !opts.dryRun) {
    try {
      const crm = await createCRM(profile);
      const syncResult = await crm.syncLeads(leads);
      console.log(`[run-daily] CRM 同步：${syncResult.synced} 成功 / ${syncResult.failed} 失败`);
      if (syncResult.failed > 0) {
        syncResult.errors.forEach(e => errors.push(`[crm] ${e.cid}: ${e.error}`));
      }
      await updateStep(2, 'completed', syncResult);
    } catch (e) {
      errors.push(`CRM 同步失败：${e instanceof Error ? e.message : String(e)}`);
      await updateStep(2, 'failed', undefined, String(e));
    }
  } else {
    await updateStep(2, 'completed', { skipped: true });
  }

  // 7. 引导任务生成
  await updateStep(3, 'running');
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
      console.log(`[run-daily] 生成 ${tasksCount} 个任务 → ${tasksPath}`);
      await updateStep(3, 'completed', { tasksCount });
    } catch (e) {
      errors.push(`任务生成失败：${e instanceof Error ? e.message : String(e)}`);
      await updateStep(3, 'failed', undefined, String(e));
    }
  } else {
    await updateStep(3, 'completed', { skipped: true });
  }

  // 7b. 任务执行（§3.6.5）—— 把生成的 task 喂给 task-executor
  let tasksExecuted = 0;
  let executionResults: ExecutionResult[] = [];
  if (!opts.dryRun && tasks.length > 0) {
    try {
      const safety: SafetyConfig = loadSafetyConfig();
      const execCrm = await createCRM(profile);
      const execFn = opts.injectExecuteTasks ?? executeTasks;
      executionResults = await execFn(tasks, safety, { crm: execCrm });
      tasksExecuted = executionResults.length;
      console.log(`[run-daily] 任务执行：${tasksExecuted}/${tasksCount} 完成`);
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
      console.log(`[run-daily] 转化日报：新发现=${report.new_leads} 加微=${report.new_wechat_added} 预约=${report.new_bookings} 成交=${report.new_deals_closed}`);
    } catch (e) {
      errors.push(`转化引擎失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 8. 通知
  await updateStep(5, 'running');
  try {
    const notifier = getNotifier('console');
    await notifier.send({
      title: `✨ 探星早报 ${date}`,
      body: `📊 扫描：${videosScanned} 视频 / ${comments.length} 评论 / ${leads.length} 高意向\n🎯 待执行任务：${tasksCount} 条\n✅ 已执行：${tasksExecuted} 条`,
      level: 'info',
    });
    await updateStep(5, 'completed', { notified: true });
  } catch (e) {
    errors.push(`通知失败：${e instanceof Error ? e.message : String(e)}`);
    await updateStep(5, 'failed', undefined, String(e));
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

  await markComplete(true);
  console.log(`[run-daily] 完成 | 耗时 ${result.duration_ms}ms | ${errors.length} errors`);
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
    console.warn(`[run-daily] sec_uid 模式但 channels.yaml 里 sec_uids 为空，跳过`);
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
      console.warn(`[run-daily] KOL ${secUid} 拉取失败：${e instanceof Error ? e.message : String(e)}`);
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
      console.warn(`[run-daily] 关键词 ${kw} 搜索失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const v of videos) {
    if (!v.aweme_id) continue;
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