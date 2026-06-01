/**
 * CLI 子命令：run
 *
 * 用法: npx explore-star run --business <dir> [--dry-run]
 *       跑每日主流程（§3.7 编排器）
 */

import { runDaily } from '../orchestration/run-daily.js';

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

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

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

function extractFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export async function runCLI(args: string[]): Promise<void> {
  await runRun(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}