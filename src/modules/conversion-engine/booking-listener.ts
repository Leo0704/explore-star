/**
 * 预约监听器（§3.10 BookingProvider）
 *
 * V1.4 实现：调 BookingProvider（飞书日历 / webhook / manual）
 * 监听新预约事件 → 自动更新 lead 状态为"已预约"
 */

import type { CRMAdapter, LeadStatus } from '../../core/types.js';
import { getBookingProvider } from '../../adapters/registry.js';

export interface BookingListenerOptions {
  crm: CRMAdapter;
  /** 轮询间隔（毫秒，默认 30s） */
  pollIntervalMs?: number;
}

/**
 * 启动预约监听循环，持续监听新预约事件
 */
export async function watchBookings(
  opts: BookingListenerOptions,
): Promise<void> {
  console.log(`[booking-listener] 启动`);

  let provider: ReturnType<typeof getBookingProvider> | null = null;
  try {
    provider = getBookingProvider('feishu_calendar');
  } catch {
    // Provider not available
  }

  if (!provider) {
    console.log('[booking-listener] 无可用 BookingProvider，退出');
    return;
  }

  try {
    for await (const event of provider.watchBookings()) {
      if (event.type === 'booked' && event.cid) {
        await opts.crm.updateStatus(event.cid, '已预约', `预约事件：${event.channel}`);
        console.log(`[booking-listener] 已预约 lead ${event.cid}`);
      }
    }
  } catch (e) {
    console.error(`[booking-listener] 监听出错：${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 手动触发一次预约同步（用于 cron 调用）
 * 注意：V1.4 的 BookingProvider 只有 watchBookings()（流式），没有 getUpcomingBookings()
 * 这里简化处理，只记录状态
 */
export async function syncBookingsOnce(
  _opts: BookingListenerOptions,
): Promise<{ synced: number; errors: string[] }> {
  // V1.4: 实时监听通过 watchBookings()，手动触发暂不支持
  return { synced: 0, errors: [] };
}