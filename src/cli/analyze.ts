/**
 * CLI 子命令：analyze
 *
 * 用法: npx explore-star analyze --business <dir> --input <file> --output <file> --threshold <n>
 *       单跑意图分析
 */

import { readFile } from 'node:fs/promises';
import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getLLM } from '../adapters/registry.js';
import { analyzeComments } from '../modules/intent-analyzer/index.js';

const USAGE = `
用法:
  npx explore-star analyze --business <dir> --input <file> --output <file> [--threshold 0.7]
  npx explore-star analyze --business <dir> --input ./comments.json --output ./leads.json --threshold 0.7

选项:
  --business <dir>    业务目录
  --input <file>       输入 JSON 文件（Comment[]）
  --output <file>      输出 JSON 文件（Lead[]）
  --threshold <n>      意图分数阈值（默认 0.7）
  --dry-run            不写入文件，只打印结果
`;

export async function runAnalyze(args: string[]): Promise<void> {
  const businessDir = extractFlag(args, '--business') || './business.example/燃点-FDE';
  const inputPath = extractFlag(args, '--input');
  const outputPath = extractFlag(args, '--output');
  const threshold = parseFloat(extractFlag(args, '--threshold') || '0.7');
  const dryRun = args.includes('--dry-run');

  if (args.includes('--help') || args.includes('-h') || !inputPath) {
    console.log(USAGE);
    if (!inputPath) console.error('\n错误：缺少 --input 参数');
    return;
  }

  await registerBuiltins();

  // 加载输入
  const raw = await readFile(inputPath, 'utf-8');
  const comments = JSON.parse(raw);

  // 加载业务配置
  const loaded = await loadBusinessProfile(businessDir);

  // 分析
  const result = await analyzeComments(comments, {
    profile: loaded.profile,
    promptsDir: loaded.promptsDir,
    threshold,
    llmOverride: getLLM(loaded.profile.llm.provider),
  });

  console.log(`[analyze] 分析完成：${result.leads.length} 个高意向 lead（阈值 ${threshold}）`);
  console.log(`  通过：${result.leads.length}`);
  console.log(`  拒绝：${result.rejected.length}`);
  console.log(`  营销过滤：${result.marketingFiltered}`);

  if (!dryRun && outputPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outputPath, JSON.stringify(result.leads, null, 2), 'utf-8');
    console.log(`  → 已写入 ${outputPath}`);
  }
}

function extractFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export async function runCLI(args: string[]): Promise<void> {
  await runAnalyze(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}