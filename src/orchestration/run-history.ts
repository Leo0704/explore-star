/**
 * 累积 run 历史（data/run_history.jsonl）
 *
 * V1.4 + Phase 0：append-only JSONL，每行一条 RunHistoryEntry
 *
 * 设计：
 *   - 原子写：写 tmp 文件后 rename 替换整个文件（不是 append）
 *     原因：JSONL append 在断电时可能损坏末尾行；rename 是 POSIX 原子操作
 *   - 文件 < 1MB 时 O(N) 重写可接受；Phase 0 不优化
 *   - 坏行：readRunHistory 跳过（log warn），不阻塞后续
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'run-history' });

export interface RunHistoryEntry {
  run_id: string;
  business: string;
  mode: 'full' | 'read-only';
  dry_run: boolean;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  exit_reason: 'completed' | 'failed' | 'login_required' | 'browser_escalated' | 'cancelled';
  step_durations: Record<string, number>;
  phase_counts: {
    videos_scanned: number;
    comments_collected: number;
    leads_created: number;
    tasks_generated: number;
    tasks_executed: number;
  };
  errors: string[];
  cost_estimate?: {
    prompt_tokens: number;
    completion_tokens: number;
    estimated_cost_usd: number;
  };
}

export async function appendRunHistory(
  filePath: string,
  entry: RunHistoryEntry,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  // 读现有内容（如果存在）
  let existing = '';
  if (existsSync(filePath)) {
    try {
      existing = await readFile(filePath, 'utf-8');
    } catch {
      existing = '';  // 读失败 → 当作空文件处理
    }
  }

  // 拼接新行（确保以 \n 分隔）
  const newLine = JSON.stringify(entry);
  const newContent = existing.length === 0 || existing.endsWith('\n')
    ? existing + newLine + '\n'
    : existing + '\n' + newLine + '\n';

  // 原子写
  const tmp = `${filePath}.tmp.${process.pid}`;
  await writeFile(tmp, newContent, 'utf-8');
  await rename(tmp, filePath);
}

export interface ReadRunHistoryOptions {
  sinceDays?: number;  // 默认 30
}

export async function readRunHistory(
  filePath: string,
  options: ReadRunHistoryOptions = {},
): Promise<RunHistoryEntry[]> {
  if (!existsSync(filePath)) return [];

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (e) {
    log.warn({ filePath, err: e }, '读取 run_history 失败，返回空数组');
    return [];
  }

  const sinceDays = options.sinceDays ?? 30;
  const cutoffMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

  const entries: RunHistoryEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as RunHistoryEntry;
      if (cutoffMs > 0 && new Date(entry.started_at).getTime() < cutoffMs) continue;
      entries.push(entry);
    } catch (e) {
      log.warn({ filePath, line: line.slice(0, 100), err: e }, '跳过损坏的 run_history 行');
    }
  }

  return entries;
}

export interface RunHistoryStats {
  totalRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  topErrors: Array<{ message: string; count: number }>;
}

export function summaryStats(entries: RunHistoryEntry[]): RunHistoryStats {
  if (entries.length === 0) {
    return { totalRuns: 0, failedRuns: 0, avgDurationMs: 0, topErrors: [] };
  }

  const failedRuns = entries.filter(e => e.exit_reason !== 'completed').length;
  const totalDuration = entries.reduce((sum, e) => sum + e.duration_ms, 0);
  const avgDurationMs = Math.round(totalDuration / entries.length);

  // 错误聚合（按消息原样 dedup，Phase 0 不做归一化）
  const errorCounts = new Map<string, number>();
  for (const e of entries) {
    for (const errMsg of e.errors) {
      errorCounts.set(errMsg, (errorCounts.get(errMsg) ?? 0) + 1);
    }
  }
  const topErrors = [...errorCounts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { totalRuns: entries.length, failedRuns, avgDurationMs, topErrors };
}
