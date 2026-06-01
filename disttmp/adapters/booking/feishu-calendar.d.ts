/**
 * 飞书日历事件监听 BookingProvider
 *
 * 依赖：
 *   - FEISHU_APP_ID, FEISHU_APP_SECRET（与飞书 CRM 共用）
 *   - 飞书日历 ID（FEISHU_CALENDAR_ID）
 *
 * 原理：轮询飞书日历 API，检测新增事件，映射为 BookingEvent。
 */
import type { BookingEvent, BookingProvider } from './base.js';
interface FeishuCalendarConfig {
    calendarId: string;
}
export declare class FeishuCalendarBooking implements BookingProvider {
    private tokenCache?;
    private readonly config;
    private readonly baseUrl;
    constructor(config: FeishuCalendarConfig);
    watchBookings(): AsyncIterable<BookingEvent>;
    ping(): Promise<boolean>;
    private fetchEvents;
    private parseEvent;
    private getToken;
}
export {};
