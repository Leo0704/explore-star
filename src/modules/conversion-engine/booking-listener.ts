/**
 * 预约监听器（§3.10 BookingProvider）
 *
 * V1.4 实现：调 BookingProvider（飞书日历 / webhook / manual）
 * 监听新预约事件 → 自动更新 lead 状态为"已预约"
 */

import { getBookingProvider } from '../../adapters/booking/index.js';
import type { CRMAdapter, Lead } from '../../core/types.js';

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
  const interval = opts.pollIntervalMs ?? 30_000;
  const seenBookings = new Set<string>();

  console.log(`[booking-listener] 启动，轮询间隔 ${interval}ms`);

  while (true) {
    try {
      const provider = getBookingProvider();
      if (!provider) {
        console.warn('[booking-listener] 无可用 BookingProvider，跳过');
        await sleep(interval);
        continue;
      }

      const events = await provider.getUpcomingBookings?.() ?? [];
      for (const event of events) {
        if (seenBookings.has(event.booking_id)) continue;
        seenBookings.add(event.booking_id);

        // 尝试找关联的 lead
        if (event.lead_cid) {
          await opts.crm.updateStatus(event.lead_cid, '已预约', `预约事件：${event.title ?? ''}`);
          console.log(`[booking-listener] 已预约 lead ${event.lead_cid}：${event.title}`);
        }
      }
    } catch (e) {
      console.error(`[booking-listener] 轮询出错：${e instanceof Error ? e.message : String(e)}`);
    }

    await sleep(interval);
  }
}

/**
 * 手动触发一次预约同步（用于 cron 调用）
 */
export async function syncBookingsOnce(
  opts: BookingListenerOptions,
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  try {
    const provider = getBookingProvider();
    if (!provider) return { synced: 0, errors: ['无可用 BookingProvider'] };

    const events = await provider.getUpcomingBookings?.() ?? [];
    for (const event of events) {
      if (!event.lead_cid) continue;
      try {
        await opts.crm.updateStatus(event.lead_cid, '已预约', `预约事件：${event.title ?? ''}`);
        synced++;
      } catch (e) {
        errors.push(`${event.lead_cid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    errors.push(String(e));
  }

  return { synced, errors };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}