import { readFile } from 'node:fs/promises';
import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getLLM } from '../adapters/registry.js';
import { analyzeComments } from '../modules/intent-analyzer/index.js';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';
import type { Comment } from '../core/types.js';

const USAGE = `
用法:
  npx explore-star analyze --business <dir> --input <file> --output <file> [--threshold 0.7]
  npx explore-star analyze --business <dir> --input ./comments.json --output ./leads.json --threshold 0.7

选项:
  --business <dir>     业务目录（必填）
  --input <file>       输入 JSON 文件（Comment[]）
  --output <file>      输出 JSON 文件（Lead[]）
  --threshold <n>      意图分数阈值（默认 0.7）
  --dry-run            不写入文件，只打印结果
`;

export async function runAnalyze(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const businessDir = extractFlag(args, '--business');
  if (!businessDir) {
    console.log(USAGE);
    console.error('\n错误：analyze 需要 --business <dir>');
    process.exit(1);
  }
  const inputPath = extractFlag(args, '--input');
  const outputPath = extractFlag(args, '--output');
  const threshold = parseFloat(extractFlag(args, '--threshold') || '0.7');
  const dryRun = args.includes('--dry-run');

  if (!inputPath) {
    console.log(USAGE);
    console.error('\n错误：缺少 --input 参数');
    return;
  }

  await registerBuiltins();

  const raw = await readFile(inputPath, 'utf-8');
  let comments: Comment[];
  try {
    comments = JSON.parse(raw) as Comment[];
  } catch (e) {
    console.error(`[analyze] ❌ 解析 ${inputPath} 失败：${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const loaded = await loadBusinessProfile(businessDir);

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

export async function runCLI(args: string[]): Promise<void> {
  await runAnalyze(args);
}

selfInvoke(import.meta.url, runCLI);