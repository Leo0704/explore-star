/**
 * CRM 同步失败队列（DLQ）消费者
 *
 * 扫描 `data/failed/crm-sync-*.json`，对每条 lead 重试 sync。
 * - 全部成功 → 删除文件
 * - 仍失败 → 累计 retry_count → 归档到 `data/failed/_archive/crm-sync-{date}-run-{n}.json` + 飞书告警
 *
 * 退避策略：1s, 2s, 4s（最多 maxRetries 次，默认 3）
 *
 * 设计要点：
 * - 单条重试（`crm.syncLeads([lead])`），一条失败不影响其它
 * - 不重跑 LLM 分析 / 评论抓取（CLAUDE.md "精准改动"）
 * - 飞书未注册时 fallback console（用 `getNotifier` 链式查询）
 */

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { CRMAdapter, Lead, Notifier, SyncResult } from '../../core/types.js';
import { ConsoleNotifier } from '../../adapters/notifier/console.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'crm-sync/dlq' });

// 尝试 lazy import registry（避免循环依赖）；失败时退到 console
async function resolveNotifier(): Promise<Notifier> {
  try {
    const { getNotifier } = await import('../../adapters/registry.js');
    try {
      return getNotifier('feishu');
    } catch {
      return getNotifier('console');
    }
  } catch {
    return new ConsoleNotifier();
  }
}

export interface ConsumeDlqOptions {
  crm: CRMAdapter;
  /** 单条 lead 最多重试次数（默认 3） */
  maxRetries?: number;
  /** 仅模拟，不删除/归档文件，仍调 CRM（默认 false） */
  dryRun?: boolean;
  /** 失败文件目录（默认 data/failed） */
  failedDir?: string;
  /** 注入 notifier；不传则用 getNotifier('feishu') → console */
  notifier?: Notifier;
  /** 注入 sleep（测试用），默认 1s × 2^(attempt-1) */
  sleep?: (ms: number) => Promise<void>;
}

export interface ConsumeDlqResult {
  /** 总重试尝试次数（所有 lead 的所有 attempt 之和） */
  retried: number;
  /** 最终成功的 lead 数 */
  succeeded: number;
  /** 最终仍失败的 lead 数 */
  failed: number;
  /** 移动到 _archive 的文件数 */
  archived: number;
  /** 文件级错误（解析失败 / IO 失败） */
  errors: string[];
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export async function consumeDlq(opts: ConsumeDlqOptions): Promise<ConsumeDlqResult> {
  const {
    crm,
    maxRetries = 3,
    dryRun = false,
    failedDir = 'data/failed',
    sleep = defaultSleep,
  } = opts;

  const result: ConsumeDlqResult = { retried: 0, succeeded: 0, failed: 0, archived: 0, errors: [] };
  const notifier = opts.notifier ?? await resolveNotifier();

  // 扫描所有 crm-sync-{date}.json（排除 _archive 和非 json）
  const files = await listFailedFiles(failedDir);
  if (files.length === 0) {
    log.info({ failedDir }, '没有待重试文件');
    return result;
  }

  log.info({ files: files.length, maxRetries, dryRun }, '扫描失败文件');

  for (const file of files) {
    const filePath = join(failedDir, file);
    let leads: Lead[];
    let sourceReport: unknown;

    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      leads = extractLeads(parsed);
      sourceReport = parsed.report;
      if (!Array.isArray(leads) || leads.length === 0) {
        // 空归档 → 直接删
        if (!dryRun) await unlink(filePath);
        log.info({ file, dryRun }, '空归档，已删除');
        continue;
      }
    } catch (e) {
      result.errors.push(`解析 ${file} 失败: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    // 对每条 lead 独立重试
    const succeededLeads: Lead[] = [];
    const failedLeads: Lead[] = [];
    for (const lead of leads) {
      const { success, attempts } = await retryLead(lead, crm, maxRetries, sleep);
      result.retried += attempts;
      if (success) {
        result.succeeded++;
        succeededLeads.push(lead);
      } else {
        result.failed++;
        // 累计 retry_count（从 lead 上读，没有则视为 0）
        const prevCount = (lead as Lead & { retry_count?: number }).retry_count ?? 0;
        failedLeads.push({ ...lead, retry_count: prevCount + attempts } as Lead & { retry_count?: number });
      }
    }

    if (failedLeads.length === 0) {
      // 全部成功 → 删文件
      if (!dryRun) {
        await unlink(filePath);
        log.info({ file, count: leads.length }, '全部重试成功，已删除');
      } else {
        log.info({ file, count: leads.length }, '全部重试成功（dry-run）');
      }
    } else {
      // 仍有失败 → 归档 + 告警
      const date = extractDateFromFile(file);
      const archivePath = await nextArchivePath(failedDir, date);

      const archiveData = {
        archived_at: new Date().toISOString(),
        source_file: file,
        report: sourceReport,
        retry_summary: {
          retried: result.retried,
          succeeded: succeededLeads.length,
          failed: failedLeads.length,
        },
        leads: failedLeads,
      };

      if (!dryRun) {
        await mkdir(dirname(archivePath), { recursive: true });
        await writeFile(archivePath, JSON.stringify(archiveData, null, 2), 'utf-8');
        await unlink(filePath);
        result.archived++;
      }

      log.info({ file, failed: failedLeads.length, dryRun, archivePath }, '仍有失败');

      if (!dryRun) {
        // 仅在真实归档时告警（避免 dry-run 噪音）
        await notifier.send({
          title: 'CRM 同步 DLQ 告警',
          body: buildAlertBody(file, failedLeads),
          level: 'critical',
        });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** 默认 sleep：1s, 2s, 4s, 8s ... */
function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 扫描 crm-sync-{date}.json，排除 _archive 目录和非 json */
async function listFailedFiles(failedDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(failedDir);
  } catch {
    return [];
  }
  return entries
    .filter(f => f.startsWith('crm-sync-') && f.endsWith('.json'))
    .sort();
}

/** 兼容两种格式：
 *  - 完整归档：{ archived_at, report, leads: Lead[] }
 *  - 裸数组：Lead[]（手测时 echo 创建的）
 */
function extractLeads(parsed: unknown): Lead[] {
  if (Array.isArray(parsed)) {
    return parsed as Lead[];
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { leads?: unknown }).leads)) {
    return (parsed as { leads: Lead[] }).leads;
  }
  return [];
}

/** 单条 lead 重试循环：返回 { success, attempts } */
async function retryLead(
  lead: Lead,
  crm: CRMAdapter,
  maxRetries: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ success: boolean; attempts: number }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result: SyncResult = await crm.syncLeads([lead]);
      if (result.failed === 0) {
        return { success: true, attempts: attempt };
      }
    } catch {
      // CRM 调用本身抛错，视为本轮失败，继续重试
    }

    if (attempt < maxRetries) {
      // 1s, 2s, 4s
      const delay = 1000 * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }
  return { success: false, attempts: maxRetries };
}

/** 从 `crm-sync-2026-06-02.json` 提取 `2026-06-02` */
function extractDateFromFile(file: string): string {
  return file.replace(/^crm-sync-/, '').replace(/\.json$/, '');
}

/** 计算下一个可用的归档文件名：crm-sync-{date}-run-{n}.json */
async function nextArchivePath(failedDir: string, date: string): Promise<string> {
  const archiveDir = join(failedDir, '_archive');
  let existing: string[] = [];
  try {
    existing = await readdir(archiveDir);
  } catch {
    // 目录不存在 → 视为无历史
  }
  const pattern = new RegExp(`^crm-sync-${date}-run-(\\d+)\\.json$`);
  const usedNums = existing
    .map(f => pattern.exec(f)?.[1])
    .filter((n): n is string => !!n)
    .map(n => parseInt(n, 10));
  const next = usedNums.length === 0 ? 1 : Math.max(...usedNums) + 1;
  return join(archiveDir, `crm-sync-${date}-run-${next}.json`);
}

/** 构造告警正文 */
function buildAlertBody(file: string, leads: Array<Lead & { retry_count?: number }>): string {
  const lines: string[] = [
    `失败文件: ${file}`,
    `仍失败 ${leads.length} 条（已重试达上限）:`,
  ];
  const sample = leads.slice(0, 10);
  for (const l of sample) {
    lines.push(`  - cid=${l.cid} nickname=${l.nickname} retry_count=${l.retry_count ?? '?'}`);
  }
  if (leads.length > sample.length) {
    lines.push(`  ...还有 ${leads.length - sample.length} 条`);
  }
  lines.push(`\n归档位置: data/failed/_archive/${file.replace('.json', '')}-run-*.json`);
  return lines.join('\n');
}
