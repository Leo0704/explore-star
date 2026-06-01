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
import type { Comment, Lead } from '../core/types.js';
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
}

export interface RunDailyResult {
  date: string;
  videosScanned: number;
  commentsCollected: number;
  leadsCreated: number;
  tasksGenerated: number;
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
      const systemPrompt = await loadSystemPrompt(loaded.promptsDir, profile);
      const userTpl = await readFileFromPrompts(loaded.promptsDir, 'intent-user.md');
      const llm = opts.injectLLM ?? (await import('../adapters/registry.js')).getLLM(profile.llm.provider);

      const batchCtx: import('../modules/intent-analyzer/batch.js').BatchContext = {
        profile,
        systemPrompt,
        userTplStr: userTpl,
        llm,
        threshold: 0.7,
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
  if (!opts.dryRun) {
    try {
      const { generateDailyTasks } = await import('../modules/nurture-engine/index.js');
      const crm = await createCRM(profile);
      const allLeads = await crm.listLeads({ has_open_task: true });
      const tasks = generateDailyTasks(allLeads, { profile, conversion: conversion, dailyTaskLimit: opts.dailyTaskLimit });
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

  // 8. 通知
  await updateStep(5, 'running');
  try {
    const notifier = getNotifier('console');
    await notifier.send({
      title: `✨ 探星早报 ${date}`,
      body: `📊 扫描：${videosScanned} 视频 / ${comments.length} 评论 / ${leads.length} 高意向\n🎯 待执行任务：${tasksCount} 条`,
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

async function createCRM(_profile: import('../core/types.js').BusinessProfile) {
  const { CsvCRM } = await import('../adapters/crm/csv.js');
  return new CsvCRM('./data/leads.csv');
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