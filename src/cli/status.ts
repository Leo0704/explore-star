import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';
import { readRunHistory, summaryStats, type RunHistoryEntry } from '../orchestration/run-history.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'cli/status' });

const USAGE = `
用法:
  npx explore-star status --business <dir>
  npx explore-star status --business <dir> --days 30
  npx explore-star status --business <dir> --json

选项:
  --business <dir>    业务目录（必填）
  --days <n>          查看最近 N 天（默认 7）
  --json              输出结构化 JSON
`.trim();

function resolveHistoryPath(businessDir: string): string {
  return join(businessDir, 'data', 'run_history.jsonl');
}

export interface StatusOptions {
  business: string;
  days: number;
  entries: RunHistoryEntry[];
}

export function formatStatusHuman(opts: StatusOptions): string {
  const stats = summaryStats(opts.entries);
  const failureRate = stats.totalRuns === 0 ? 0 : (stats.failedRuns / stats.totalRuns) * 100;
  const recent5 = opts.entries
    .slice()
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 5);

  let out = `📊 探星健康概览 · ${opts.business} · 最近 ${opts.days} 天\n\n`;
  out += `✅ Run 总数：${stats.totalRuns}\n`;
  out += `❌ 失败数：${stats.failedRuns} (${failureRate.toFixed(1)}%)\n`;
  out += `⏱  平均耗时：${(stats.avgDurationMs / 1000).toFixed(1)}s\n\n`;

  if (stats.topErrors.length > 0) {
    out += `🔥 Top 错误：\n`;
    for (const e of stats.topErrors) {
      out += `  [${e.count}x] ${e.message}\n`;
    }
    out += `\n`;
  }

  if (recent5.length > 0) {
    out += `最近 ${Math.min(5, recent5.length)} 次 run：\n`;
    for (const r of recent5) {
      const date = r.started_at.slice(0, 16).replace('T', ' ');
      const icon = r.exit_reason === 'completed' ? '✅' : '❌';
      out += `  ${date}  ${icon} ${r.exit_reason.padEnd(20)} ${(r.duration_ms / 1000).toFixed(1)}s\n`;
    }
  } else {
    out += `⚠️  最近 ${opts.days} 天无 run。\n`;
  }

  return out;
}

export function formatStatusJson(opts: StatusOptions): string {
  const stats = summaryStats(opts.entries);
  return JSON.stringify({
    business: opts.business,
    days: opts.days,
    stats,
    entries: opts.entries.slice(-5),  // 最近 5 条
  }, null, 2);
}

export function decideExitCode(entries: RunHistoryEntry[], neverRunBefore: boolean): number {
  if (entries.length === 0) {
    return neverRunBefore ? 0 : 1;  // 从未跑过 = 0；跑了但停了 = 1
  }
  // 最近一次 run（按 started_at 倒序第一个）
  const lastEntry = entries.slice().sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  return lastEntry.exit_reason === 'completed' ? 0 : 1;
}

export async function runStatus(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const business = extractFlag(args, '--business');
  if (!business) {
    console.log(USAGE);
    console.error('\n错误：status 需要 --business <dir>');
    process.exit(1);
  }
  const daysRaw = extractFlag(args, '--days');
  const days = daysRaw ? Math.max(1, parseInt(daysRaw, 10)) : 7;
  const jsonMode = args.includes('--json');

  const historyPath = resolveHistoryPath(business);

  const neverRunBefore = !existsSync(historyPath);
  const entries = neverRunBefore ? [] : await readRunHistory(historyPath, { sinceDays: days });

  const opts: StatusOptions = { business, days, entries };

  if (jsonMode) {
    console.log(formatStatusJson(opts));
  } else {
    console.log(formatStatusHuman(opts));
  }

  const exitCode = decideExitCode(entries, neverRunBefore);
  if (exitCode !== 0) {
    log.warn({ exitCode, business }, 'status 检测到异常，退出码非 0');
    process.exit(exitCode);
  }
}

export async function runCLI(args: string[]): Promise<void> {
  await runStatus(args);
}

selfInvoke(import.meta.url, runCLI);
