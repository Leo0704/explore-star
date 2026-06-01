/**
 * CLI 子命令：watch-bookings
 *
 * 用法: npx explore-star watch-bookings --business <dir>
 *       启动预约监听循环
 */

import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getCRM } from '../adapters/registry.js';
import { watchBookings } from '../modules/conversion-engine/booking-listener.js';

const USAGE = `
用法:
  npx explore-star watch-bookings --business <dir>
  npx explore-star watch-bookings --business ./my-business

说明:
  启动预约监听循环，持续监听新预约事件并更新 CRM 中的 lead 状态。
  此命令会持续运行，直到手动终止（Ctrl+C）。

选项:
  --business <dir>    业务目录
  --poll-interval <ms>  轮询间隔（默认 30000ms）
`;

export async function runWatchBookings(args: string[]): Promise<void> {
  const businessDir = extractFlag(args, '--business') || './business.example/燃点-FDE';
  const pollInterval = parseInt(extractFlag(args, '--poll-interval') || '30000');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  await registerBuiltins();

  // 加载业务配置
  const loaded = await loadBusinessProfile(businessDir);
  // loaded 目前未被直接使用，但保留接口一致性

  // CRM
  const crm = getCRM('csv');

  console.log(`[watch-bookings] 启动预约监听 | business=${businessDir} | poll=${pollInterval}ms`);
  console.log('  按 Ctrl+C 终止\n');

  // 启动监听
  await watchBookings({ crm, pollIntervalMs: pollInterval });
}

function extractFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export async function runCLI(args: string[]): Promise<void> {
  await runWatchBookings(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}