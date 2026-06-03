import { registerBookingProvider, listBookingProviders } from '../registry.js';
import { FeishuCalendarBooking } from './feishu-calendar.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'adapters/booking' });

export function registerAll(): void {
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_CALENDAR_ID) {
    const provider = new FeishuCalendarBooking({ calendarId: process.env.FEISHU_CALENDAR_ID });
    registerBookingProvider('feishu_calendar', provider);
  }

  log.info({ providers: listBookingProviders() }, '已注册 BookingProvider');
}

export { FeishuCalendarBooking } from './feishu-calendar.js';
export type { BookingEvent, BookingProvider } from './base.js';