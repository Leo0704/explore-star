import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CRMAdapter, Lead, SyncResult } from '../../core/types.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'crm-sync' });

export interface CrmSyncOptions {
  failedDir?: string;
  failedPrefix?: string;
}

export interface CrmSyncReport {
  total: number;
  synced: number;
  failed: number;
  failedCids: string[];
  errors: Array<{ cid: string; error: string }>;
}

export async function syncLeads(
  crm: CRMAdapter,
  leads: Lead[],
  opts: CrmSyncOptions = {}
): Promise<CrmSyncReport> {
  const failedDir = opts.failedDir ?? 'data/failed';
  const failedPrefix = opts.failedPrefix ?? 'crm-sync';

  if (leads.length === 0) {
    return { total: 0, synced: 0, failed: 0, failedCids: [], errors: [] };
  }

  let result: SyncResult;
  try {
    result = await crm.syncLeads(leads);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const report: CrmSyncReport = {
      total: leads.length,
      synced: 0,
      failed: leads.length,
      failedCids: leads.map(l => l.cid),
      errors: leads.map(l => ({ cid: l.cid, error: errorMsg })),
    };

    await archiveFailedLeads(failedDir, failedPrefix, report, leads);
    return report;
  }

  const report: CrmSyncReport = {
    total: leads.length,
    synced: result.synced,
    failed: result.failed,
    failedCids: result.errors.map(e => e.cid),
    errors: result.errors,
  };

  if (result.failed > 0) {
    const failedLeads = leads.filter(l => result.errors.some(e => e.cid === l.cid));
    await archiveFailedLeads(failedDir, failedPrefix, report, failedLeads);
  }

  return report;
}

async function archiveFailedLeads(
  failedDir: string,
  failedPrefix: string,
  report: CrmSyncReport,
  leads: Lead[]
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const date = timestamp.split('T')[0];
  const fileName = `${failedPrefix}-${date}.json`;
  const filePath = join(failedDir, fileName);

  await mkdir(dirname(filePath), { recursive: true });

  const archive = {
    archived_at: new Date().toISOString(),
    report,
    leads,
  };

  await writeFile(filePath, JSON.stringify(archive, null, 2), 'utf-8');
  log.info({ failed: report.failed, filePath }, '归档失败记录');
}

export async function runCLI(args: string[]): Promise<void> {
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const crmType = get('--crm') || 'csv';
  const crmConfigPath = get('--crm-config');
  const inputPath = get('--input') || 'data/tmp/leads.json';
  const outputPath = get('--output') || 'data/tmp/sync-report.json';

  if (!crmConfigPath) {
    console.error('错误：crm-sync 需要 --crm-config <path>');
    console.error('  --crm csv:   传入 CSV 文件路径（如 ./data/leads.csv）');
    console.error('  --crm feishu: 传入 JSON 配置文件路径');
    process.exit(1);
  }

  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');

  const inputRaw = await readFile(inputPath, 'utf-8');
  const leads: Lead[] = JSON.parse(inputRaw);

  const crm = await createCrmAdapter(crmType, crmConfigPath);

  const report = await syncLeads(crm, leads);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  log.info({ synced: report.synced, total: report.total }, '同步完成');
}

async function createCrmAdapter(type: string, configPath: string): Promise<CRMAdapter> {
  switch (type) {
    case 'csv': {
      const { CsvCRM } = await import('../../adapters/crm/csv.js');
      return new CsvCRM(configPath);
    }
    case 'feishu': {
      const { FeishuCRM } = await import('../../adapters/crm/feishu.js');
      const configRaw = await readFile(configPath, 'utf-8');
      const config = JSON.parse(configRaw);
      return new FeishuCRM(config);
    }
    default:
      throw new Error(`不支持的 CRM 类型: ${type}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}