import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getCRM } from '../adapters/registry.js';
import { watchBookings } from '../modules/conversion-engine/booking-listener.js';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';

const USAGE = `
用法:
  npx explore-star watch-bookings --business <dir>
  npx explore-star watch-bookings --business ./my-business

说明:
  启动预约监听循环，持续监听新预约事件并更新 CRM 中的 lead 状态。
  此命令会持续运行，直到手动终止（Ctrl+C）。

选项:
  --business <dir>    业务目录（必填）
  --poll-interval <ms>  轮询间隔（默认 30000ms）
`;

export async function runWatchBookings(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const businessDir = extractFlag(args, '--business');
  if (!businessDir) {
    console.log(USAGE);
    console.error('\n错误：watch-bookings 需要 --business <dir>');
    process.exit(1);
  }
  const pollInterval = parseInt(extractFlag(args, '--poll-interval') || '30000');

  await registerBuiltins();

  const loaded = await loadBusinessProfile(businessDir);

  const crm = getCRM('csv');

  console.log(`[watch-bookings] 启动预约监听 | business=${businessDir} | poll=${pollInterval}ms`);
  console.log('  按 Ctrl+C 终止\n');

  await watchBookings({ crm, pollIntervalMs: pollInterval });
}

export async function runCLI(args: string[]): Promise<void> {
  await runWatchBookings(args);
}

selfInvoke(import.meta.url, runCLI);