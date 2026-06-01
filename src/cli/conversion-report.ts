/**
 * CLI 子命令：conversion-report
 *
 * 用法: npx explore-star conversion-report --business <dir>
 *       生成并推送转化日报（等同于 convert，但输出更详细）
 */

import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getCRM } from '../adapters/registry.js';
import { generateConversionReport, pushConversionReport } from '../modules/conversion-engine/material-pusher.js';

const USAGE = `
用法:
  npx explore-star conversion-report --business <dir>
  npx explore-star conversion-report --business ./my-business --date 2026-06-01

选项:
  --business <dir>    业务目录
  --date <YYYY-MM-DD> 指定日期（默认今天）
  --output <file>     同时写入本地文件
`;

export async function runConversionReport(args: string[]): Promise<void> {
  const businessDir = extractFlag(args, '--business') || './business.example/燃点-FDE';
  const date = extractFlag(args, '--date') || new Date().toISOString().slice(0, 10);
  const outputPath = extractFlag(args, '--output');
  const dryRun = args.includes('--dry-run');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  await registerBuiltins();

  // 加载业务配置
  const loaded = await loadBusinessProfile(businessDir);
  const { profile, conversion } = loaded;

  // CRM
  const crm = getCRM('csv');

  // 生成报告
  const report = await generateConversionReport(date, { profile, conversion, crm });

  // 输出详细报告
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

  // 写文件
  if (outputPath) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n→ 已写入 ${outputPath}`);
  }

  // 推送
  if (!dryRun) {
    await pushConversionReport(report);
    console.log('→ 已推送至通知渠道');
  }
}

function extractFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export async function runCLI(args: string[]): Promise<void> {
  await runConversionReport(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}