/**
 * CLI 子命令：nurture
 *
 * 用法: npx explore-star nurture --business <dir> --output <file>
 *       单跑引导引擎（生成每日任务）
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getCRM } from '../adapters/registry.js';
import { generateDailyTasks } from '../modules/nurture-engine/index.js';

const USAGE = `
用法:
  npx explore-star nurture --business <dir> --output <file>
  npx explore-star nurture --business ./my-business --output ./tasks.json

选项:
  --business <dir>    业务目录
  --output <file>     输出 JSON 文件（Task[]）
  --limit <n>         每日最大任务数（默认 20）
  --dry-run           不写入文件，只打印结果
`;

export async function runNurture(args: string[]): Promise<void> {
  const businessDir = extractFlag(args, '--business') || './business.example/燃点-FDE';
  const outputPath = extractFlag(args, '--output');
  const limit = parseInt(extractFlag(args, '--limit') || '20');
  const dryRun = args.includes('--dry-run');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  await registerBuiltins();

  // 加载业务配置
  const loaded = await loadBusinessProfile(businessDir);
  const { profile, conversion } = loaded;

  // 从 CRM 读取 leads
  const crm = getCRM();
  const allLeads = await crm.listLeads({ has_open_task: true });

  // 生成任务
  const tasks = generateDailyTasks(allLeads, { profile, conversion, dailyTaskLimit: limit });

  console.log(`[nurture] 生成了 ${tasks.length} 个任务`);
  if (tasks.length > 0) {
    console.log(`  High: ${tasks.filter(t => t.priority === 'high').length}`);
    console.log(`  Medium: ${tasks.filter(t => t.priority === 'medium').length}`);
    console.log(`  Low: ${tasks.filter(t => t.priority === 'low').length}`);
  }

  if (!dryRun && outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(tasks, null, 2), 'utf-8');
    console.log(`  → 已写入 ${outputPath}`);
  }
}

function extractFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export async function runCLI(args: string[]): Promise<void> {
  await runNurture(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}