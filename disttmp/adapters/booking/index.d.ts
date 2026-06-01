/**
 * Booking Adapters 索引
 *
 * 注册所有 BookingProvider 实现。
 * 注意：BookingProvider 的 watchBookings() 是长时间运行的异步迭代器，
 * 通常不由 registry 统一管理实例，而是由 ConversionEngine 按需创建。
 * 这里只注册可实例化的配置映射，供 run-daily.ts 查找。
 */
export declare function registerAll(): void;
export { FeishuCalendarBooking } from './feishu-calendar.js';
export { WebhookBooking } from './webhook.js';
export type { BookingEvent, BookingProvider } from './base.js';
