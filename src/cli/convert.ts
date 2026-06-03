/**
 * CLI 子命令：convert
 *
 * 用法: npx explore-star convert --business <dir>
 *       单跑转化引擎（转化日报）
 */

import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getCRM } from '../adapters/registry.js';
import { generateConversionReport, pushConversionReport } from '../modules/conversion-engine/material-pusher.js';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';

const USAGE = `
用法:
  npx explore-star convert --business <dir>
  npx explore-star convert --business ./my-business --verbose

选项:
  --business <dir>    业务目录（必填）
  --date <YYYY-MM-DD> 生成指定日期的日报（默认今天）
  --verbose           详细输出（漏斗/营收/ROI/Hot Leads/At Risk）
  --output <file>     同时写入本地文件
  --dry-run           不推送，只生成报告
`;

export async function runConvert(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const businessDir = extractFlag(args, '--business');
  if (!businessDir) {
    console.log(USAGE);
    console.error('\n错误：convert 需要 --business <dir>');
    process.exit(1);
  }
  const date = extractFlag(args, '--date') || new Date().toLocaleDateString('en-CA');
  const verbose = args.includes('--verbose');
  const outputPath = extractFlag(args, '--output');
  const dryRun = args.includes('--dry-run');

  await registerBuiltins();

  // 加载业务配置
  const loaded = await loadBusinessProfile(businessDir);
  const { profile, conversion } = loaded;

  // CRM
  const crm = getCRM('csv');

  // 生成报告
  const report = await generateConversionReport(date, { profile, conversion, crm });

  if (verbose) {
    // 详细输出（原 conversion-report.ts）
    console.log(`\n📈 探星转化日报 ${report.date}`);
    console.log('\n[今日漏斗]');
    console.log(`  新发现：${report.new_leads}`);
    console.log(`  加微：${report.new_wechat_added}`);
    console.log(`  预约：${report.new_bookings}`);
    console.log(`  成交：${report.new_deals_closed}`);

    console.log('\n[营收]');
    console.log(`  今日：¥${report.revenue_today.toLocaleString()}`);
    console.log(`  本周：¥${report.weekly_revenue.toLocaleString()}`);

    console.log('\n[ROI]');
    console.log(`  成本：¥${report.cost_today} | ROI：${report.roi_today.toFixed(1)}x`);

    if (report.hot_leads.length > 0) {
      console.log('\n[Hot Leads] 即将成交');
      for (const l of report.hot_leads) {
        console.log(`  - @${l.nickname}（${l.status}，意向 ${l.intent_score}）`);
      }
    }

    if (report.at_risk_leads.length > 0) {
      console.log('\n[At Risk] 可能流失');
      for (const l of report.at_risk_leads) {
        const days = l.wechat_added_at
          ? Math.round((Date.now() - new Date(l.wechat_added_at).getTime()) / 86400000)
          : '?';
        console.log(`  - @${l.nickname}（加微 ${days} 天）`);
      }
    }
  } else {
    // 精简输出
    console.log(`[convert] 转化日报 ${date}`);
    console.log(`  新发现：${report.new_leads}`);
    console.log(`  加微：${report.new_wechat_added}`);
    console.log(`  预约：${report.new_bookings}`);
    console.log(`  成交：${report.new_deals_closed}`);
    console.log(`  ROI：${report.roi_today.toFixed(1)}x`);
    console.log(`  Hot Leads：${report.hot_leads.length}`);
    console.log(`  At Risk：${report.at_risk_leads.length}`);
  }

  // 写文件
  if (outputPath) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n→ 已写入 ${outputPath}`);
  }

  if (!dryRun) {
    await pushConversionReport(report);
    console.log(verbose ? '→ 已推送至通知渠道' : '  → 已推送');
  }
}

export async function runCLI(args: string[]): Promise<void> {
  await runConvert(args);
}

selfInvoke(import.meta.url, runCLI);
