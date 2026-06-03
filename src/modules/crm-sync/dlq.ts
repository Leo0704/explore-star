import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { CRMAdapter, Lead, Notifier, SyncResult } from '../../core/types.js';
import { ConsoleNotifier } from '../../adapters/notifier/console.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'crm-sync/dlq' });

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
  maxRetries?: number;
  dryRun?: boolean;
  failedDir?: string;
  notifier?: Notifier;
  sleep?: (ms: number) => Promise<void>;
}

export interface ConsumeDlqResult {
  retried: number;
  succeeded: number;
  failed: number;
  archived: number;
  errors: string[];
}

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
        if (!dryRun) await unlink(filePath);
        log.info({ file, dryRun }, '空归档，已删除');
        continue;
      }
    } catch (e) {
      result.errors.push(`解析 ${file} 失败: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

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
        const prevCount = (lead as Lead & { retry_count?: number }).retry_count ?? 0;
        failedLeads.push({ ...lead, retry_count: prevCount + attempts } as Lead & { retry_count?: number });
      }
    }

    if (failedLeads.length === 0) {
      if (!dryRun) {
        await unlink(filePath);
        log.info({ file, count: leads.length }, '全部重试成功，已删除');
      } else {
        log.info({ file, count: leads.length }, '全部重试成功（dry-run）');
      }
    } else {
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
        try {
          await unlink(filePath);
        } catch (e) {
          log.warn(
            { file, err: e instanceof Error ? e.message : String(e) },
            'unlink source failed; archive preserved',
          );
        }
        result.archived++;
      }

      log.info({ file, failed: failedLeads.length, dryRun, archivePath }, '仍有失败');

      if (!dryRun) {
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function extractLeads(parsed: unknown): Lead[] {
  if (Array.isArray(parsed)) {
    return parsed as Lead[];
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { leads?: unknown }).leads)) {
    return (parsed as { leads: Lead[] }).leads;
  }
  return [];
}

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
    }

    if (attempt < maxRetries) {
      const delay = 1000 * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }
  return { success: false, attempts: maxRetries };
}

function extractDateFromFile(file: string): string {
  return file.replace(/^crm-sync-/, '').replace(/\.json$/, '');
}

async function nextArchivePath(failedDir: string, date: string): Promise<string> {
  const archiveDir = join(failedDir, '_archive');
  let existing: string[] = [];
  try {
    existing = await readdir(archiveDir);
  } catch {
  }
  const pattern = new RegExp(`^crm-sync-${date}-run-(\\d+)\\.json$`);
  const usedNums = existing
    .map(f => pattern.exec(f)?.[1])
    .filter((n): n is string => !!n)
    .map(n => parseInt(n, 10));
  const next = usedNums.length === 0 ? 1 : Math.max(...usedNums) + 1;
  return join(archiveDir, `crm-sync-${date}-run-${next}.json`);
}

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
