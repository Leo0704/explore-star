/**
 * CLI 子命令：run
 *
 * 用法: npx explore-star run --business <dir> [--dry-run]
 *       跑每日主流程（§3.7 编排器）
 */

import { runDaily } from '../orchestration/run-daily.js';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';

const USAGE = `
用法:
  npx explore-star run --business <dir>
  npx explore-star run --business <dir> --dry-run
  npx explore-star run --business <dir> --step 3

选项:
  --business <dir>    业务目录（默认 ./business.example/燃点-FDE）
  --dry-run           不写入 CRM（测试用）
  --skip-llm          跳过 LLM 调用（mock 模式）
  --step <n>          只跑特定步骤（0-6）
  --daily-task-limit  每日最大任务数（默认 20）
`;

export async function runRun(args: string[]): Promise<void> {
  const businessDir = extractFlag(args, '--business') || './business.example/燃点-FDE';
  const dryRun = args.includes('--dry-run');
  const skipLLM = args.includes('--skip-llm');
  const stepFlag = extractFlag(args, '--step');
  const dailyTaskLimit = parseInt(extractFlag(args, '--daily-task-limit') || '20');

  if (showUsage(USAGE, args)) return;

  console.log(`[run] 启动主流程 | business=${businessDir} | dry-run=${dryRun}`);

  await runDaily({
    businessDir,
    dryRun,
    skipLLM,
    dailyTaskLimit,
    step: stepFlag ? parseInt(stepFlag) : undefined,
  });

  console.log(`[run] 完成`);
}

export async function runCLI(args: string[]): Promise<void> {
  await runRun(args);
}

selfInvoke(runCLI);