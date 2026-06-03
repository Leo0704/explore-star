import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins } from '../adapters/registry.js';
import { runWeeklyAnalysis } from '../modules/feedback-analyzer/index.js';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';

const USAGE = `
用法:
  npx explore-star insights --business <dir>
  npx explore-star insights --business ./my-business --last 4weeks

选项:
  --business <dir>    业务目录（必填）
  --last <n>          参考过去几周数据（默认 4）
  --output <file>     输出文件路径（默认 data/feedback/weekly-insights.json）
  --dry-run           不写入文件，只打印摘要
`;

export async function runInsights(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const businessDir = extractFlag(args, '--business');
  if (!businessDir) {
    console.log(USAGE);
    console.error('\n错误：insights 需要 --business <dir>');
    process.exit(1);
  }
  const outputPath = extractFlag(args, '--output') || './data/feedback/weekly-insights.json';
  const lastRaw = extractFlag(args, '--last');
  const weeks = lastRaw ? Math.max(1, parseInt(lastRaw, 10)) : 4;
  const dryRun = args.includes('--dry-run');

  await registerBuiltins();

  const loaded = await loadBusinessProfile(businessDir);

  const insights = await runWeeklyAnalysis(businessDir, { insightsPath: outputPath, weeks });

  console.log(`[insights] 周报 ${insights.week_start}`);
  console.log(`  学习期完成：${insights.learning_period_complete}`);
  console.log(`  关键词：${insights.keyword_performance.length} 个`);
  console.log(`  钩子风格：${insights.hook_style_performance.length} 个`);
  console.log(`  Persona：${insights.persona_value.length} 个`);
  console.log(`  最佳时段：${insights.best_interaction_times.length} 个`);

  if (!dryRun) {
    console.log(`  → 已写入 ${outputPath}`);
  }

  if (insights.keyword_performance.length > 0) {
    console.log('\n[Top 关键词]');
    const top = [...insights.keyword_performance]
      .sort((a, b) => b.smoothed_rate - a.smoothed_rate)
      .slice(0, 5);
    for (const kw of top) {
      console.log(`  ${kw.keyword}: ${kw.conversions}/${kw.leads} (${(kw.smoothed_rate * 100).toFixed(1)}%)`);
    }
  }

  if (insights.persona_value.length > 0) {
    console.log('\n[Persona 价值]');
    const top = [...insights.persona_value]
      .sort((a, b) => b.value_score - a.value_score)
      .slice(0, 3);
    for (const p of top) {
      console.log(`  ${p.persona}: ${p.value_score}/10（${p.conversions} 成交）`);
    }
  }
}

export async function runCLI(args: string[]): Promise<void> {
  await runInsights(args);
}

selfInvoke(import.meta.url, runCLI);