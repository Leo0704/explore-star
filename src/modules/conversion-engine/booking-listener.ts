/**
 * 预约监听器（§3.10 BookingProvider）
 *
 * V1.4 实现：调 BookingProvider（飞书日历 / webhook / manual）
 * 监听新预约事件 → 自动更新 lead 状态为"已预约"
 */

import type { CRMAdapter, LeadStatus } from '../../core/types.js';
import { getBookingProvider } from '../../adapters/registry.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'booking-listener' });

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
  log.info('启动');

  let provider: ReturnType<typeof getBookingProvider> | null = null;
  try {
    provider = getBookingProvider('feishu_calendar');
  } catch {
    // Provider not available
  }

  if (!provider) {
    log.info('无可用 BookingProvider，退出');
    return;
  }

  try {
    for await (const event of provider.watchBookings()) {
      if (event.type === 'booked' && event.cid) {
        await opts.crm.updateStatus(event.cid, '已预约', `预约事件：${event.channel}`);
        log.info({ cid: event.cid }, '已预约 lead');
      }
    }
  } catch (e) {
    log.error({ err: e }, '监听出错');
  }
}

