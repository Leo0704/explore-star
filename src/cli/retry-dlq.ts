import { readFile } from 'node:fs/promises';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';
import { registerBuiltins, getNotifier } from '../adapters/registry.js';
import { consumeDlq } from '../modules/crm-sync/dlq.js';
import type { CRMAdapter, Notifier } from '../core/types.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'cli/retry-dlq' });

const USAGE = `
用法:
  npx explore-star retry-dlq
  npx explore-star retry-dlq --dry-run
  npx explore-star retry-dlq --max-retries 5

选项:
  --dry-run             不删除/归档文件，仍调 CRM
  --max-retries <n>     单条 lead 最多重试次数（默认 3）
  --crm <type>          CRM 类型: csv | feishu（默认 csv）
  --crm-config <path>   CRM 配置文件路径
                        csv:     CSV 路径（默认 ./data/leads.csv）
                        feishu:  JSON 配置路径
  --failed-dir <path>   失败文件目录（默认 data/failed）

退出码：
  0   全部成功 / 无待处理文件
  1   有失败或错误
`.trim();

function resolveNotifier(): Notifier {
  try {
    return getNotifier('feishu');
  } catch {
    return getNotifier('console');
  }
}

async function createCrmAdapter(type: string, configPath: string): Promise<CRMAdapter> {
  switch (type) {
    case 'csv': {
      const { CsvCRM } = await import('../adapters/crm/csv.js');
      return new CsvCRM(configPath);
    }
    case 'feishu': {
      const { FeishuCRM } = await import('../adapters/crm/feishu.js');
      const configRaw = await readFile(configPath, 'utf-8');
      const config = JSON.parse(configRaw);
      return new FeishuCRM(config);
    }
    default:
      throw new Error(`不支持的 CRM 类型: ${type}（仅支持 csv / feishu）`);
  }
}

export async function runRetryDlq(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const dryRun = args.includes('--dry-run');
  const maxRetriesRaw = extractFlag(args, '--max-retries');
  const maxRetries = maxRetriesRaw ? Math.max(1, parseInt(maxRetriesRaw, 10)) : 3;
  const crmType = extractFlag(args, '--crm') ?? 'csv';
  const crmConfigPath = extractFlag(args, '--crm-config')
    ?? (crmType === 'csv' ? './data/leads.csv' : null);
  if (!crmConfigPath) {
    console.log(USAGE);
    console.error(`\n错误：--crm ${crmType} 需要 --crm-config <path>`);
    process.exit(1);
  }
  const failedDir = extractFlag(args, '--failed-dir') ?? 'data/failed';

  await registerBuiltins();
  const crm = await createCrmAdapter(crmType, crmConfigPath);
  const notifier = resolveNotifier();

  const result = await consumeDlq({
    crm,
    maxRetries,
    dryRun,
    failedDir,
    notifier,
  });

  log.info({
    retried: result.retried,
    succeeded: result.succeeded,
    failed: result.failed,
    archived: result.archived,
  }, 'DLQ 重试完成');
  if (result.errors.length > 0) {
    log.error({ errors: result.errors }, '文件级错误');
  }

  if (result.failed > 0 || result.errors.length > 0) {
    process.exit(1);
  }
}

export async function runCLI(args: string[]): Promise<void> {
  await runRetryDlq(args);
}

selfInvoke(import.meta.url, runCLI);
