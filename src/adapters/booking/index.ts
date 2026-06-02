/**
 * Booking Adapters 索引
 *
 * 注册所有 BookingProvider 实现。
 * 注意：BookingProvider 的 watchBookings() 是长时间运行的异步迭代器，
 * 通常不由 registry 统一管理实例，而是由 ConversionEngine 按需创建。
 * 这里只注册可实例化的配置映射，供 run-daily.ts 查找。
 */

import { registerBookingProvider, listBookingProviders } from '../registry.js';
import { FeishuCalendarBooking } from './feishu-calendar.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'adapters/booking' });

export function registerAll(): void {
  // 飞书日历
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_CALENDAR_ID) {
    const provider = new FeishuCalendarBooking({ calendarId: process.env.FEISHU_CALENDAR_ID });
    registerBookingProvider('feishu_calendar', provider);
  }

  log.info({ providers: listBookingProviders() }, '已注册 BookingProvider');
}

export { FeishuCalendarBooking } from './feishu-calendar.js';
export type { BookingEvent, BookingProvider } from './base.js';