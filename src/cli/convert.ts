/**
 * CLI 子命令：convert
 *
 * 用法: npx explore-star convert --business <dir>
 *       单跑转化引擎（转化日报）
 */

import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getCRM } from '../adapters/registry.js';
import { generateConversionReport, pushConversionReport } from '../modules/conversion-engine/material-pusher.js';

const USAGE = `
用法:
  npx explore-star convert --business <dir>
  npx explore-star convert --business ./my-business

选项:
  --business <dir>    业务目录
  --date <YYYY-MM-DD> 生成指定日期的日报（默认今天）
  --dry-run           不推送，只生成报告
`;

export async function runConvert(args: string[]): Promise<void> {
  const businessDir = extractFlag(args, '--business') || './business.example/燃点-FDE';
  const date = extractFlag(args, '--date') || new Date().toISOString().slice(0, 10);
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

  console.log(`[convert] 转化日报 ${date}`);
  console.log(`  新发现：${report.new_leads}`);
  console.log(`  加微：${report.new_wechat_added}`);
  console.log(`  预约：${report.new_bookings}`);
  console.log(`  成交：${report.new_deals_closed}`);
  console.log(`  ROI：${report.roi_today.toFixed(1)}x`);
  console.log(`  Hot Leads：${report.hot_leads.length}`);
  console.log(`  At Risk：${report.at_risk_leads.length}`);

  if (!dryRun) {
    await pushConversionReport(report);
    console.log(`  → 已推送`);
  }
}

function extractFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export async function runCLI(args: string[]): Promise<void> {
  await runConvert(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}