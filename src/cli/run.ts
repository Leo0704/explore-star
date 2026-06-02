/**
 * CLI 子命令：run
 *
 * 用法: npx explore-star run --business <dir> [--dry-run]
 *       跑每日主流程（§3.7 编排器）
 */

import { runDaily } from '../orchestration/run-daily.js';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';
import { acquireLock, releaseLock, setupSignalHandlers } from './run-lock.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'cli/run' });

const USAGE = `
用法:
  npx explore-star run --business <dir>
  npx explore-star run --business <dir> --dry-run
  npx explore-star run --business <dir> --step 3
  npx explore-star run --business <dir> --mode read-only

选项:
  --business <dir>     业务目录（必填）
  --dry-run            不写入 CRM（测试用）
  --skip-llm           跳过 LLM 调用（mock 模式）
  --step <n>           只跑特定步骤（0-6）
  --daily-task-limit   每日最大任务数（默认 20）
  --mode <full|read-only>  执行模式（默认 full）。read-only 跳过 phase 7b 任务执行；为手动开关，不会自动启用。
`;

export async function runRun(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const businessDir = extractFlag(args, '--business');
  if (!businessDir) {
    console.log(USAGE);
    console.error('\n错误：run 需要 --business <dir>');
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run');
  const skipLLM = args.includes('--skip-llm');
  const stepFlag = extractFlag(args, '--step');
  const dailyTaskLimit = parseInt(extractFlag(args, '--daily-task-limit') || '20');
  const modeFlag = extractFlag(args, '--mode');
  const mode: 'full' | 'read-only' = modeFlag === 'read-only' ? 'read-only' : 'full';

  if (!acquireLock()) {
    process.exit(1);
  }
  setupSignalHandlers(releaseLock);

  try {
    log.info({ business: businessDir, dryRun, mode }, '启动主流程');

    await runDaily({
      businessDir,
      dryRun,
      skipLLM,
      dailyTaskLimit,
      step: stepFlag ? parseInt(stepFlag) : undefined,
      mode,
    });

    log.info('完成');
  } finally {
    releaseLock();
  }
}

export async function runCLI(args: string[]): Promise<void> {
  await runRun(args);
}

selfInvoke(import.meta.url, runCLI);