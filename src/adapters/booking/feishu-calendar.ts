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

export class FeishuCalendarBooking implements BookingProvider {
  private tokenCache?: { token: string; expiresAt: number };
  private readonly config: FeishuCalendarConfig;
  private readonly baseUrl = 'https://open.feishu.cn/open-apis';

  constructor(config: FeishuCalendarConfig) {
    this.config = config;
  }

  async *watchBookings(): AsyncIterable<BookingEvent> {
    let syncToken = '';
    const intervalMs = 60_000; // 60s 轮询

    while (true) {
      try {
        const result = await this.fetchEvents(syncToken);
        for (const event of result.events) {
          if (event.status !== 'completed') continue; // 只处理已完成事件
          const bookingEvent = this.parseEvent(event);
          if (bookingEvent) yield bookingEvent;
        }
        syncToken = result.syncToken;
      } catch {
        // 轮询期间出错，静默等待下次重试
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private async fetchEvents(syncToken: string): Promise<{ events: FeishuEvent[]; syncToken: string }> {
    const token = await this.getToken();
    const params = new URLSearchParams({ page_size: '50' });
    if (syncToken) params.set('sync_token', syncToken);

    const res = await fetch(
      `${this.baseUrl}/calendar/v4/calendars/${this.config.calendarId}/events?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!res.ok) throw new Error(`飞书日历 ${res.status}`);
    const json = await res.json() as { items?: FeishuEvent[]; next_sync_token?: string };
    return {
      events: (json.items ?? []).filter(e => e.event_id && e.start_time),
      syncToken: json.next_sync_token ?? '',
    };
  }

  private parseEvent(event: FeishuEvent): BookingEvent | null {
    const summary = event.summary ?? '';
    // 从标题解析 cid，格式：探星-{cid}-{日期}
    const match = summary.match(/^探星-(.+?)-\d{4}/);
    if (!match) return null;

    return {
      cid: match[1],
      type: 'booked',
      scheduledAt: event.start_time,
      channel: 'feishu_calendar',
      occurredAt: event.created_at ?? new Date().toISOString(),
      metadata: { eventId: event.event_id, summary },
    };
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }

    const appId = process.env.FEISHU_APP_ID ?? '';
    const appSecret = process.env.FEISHU_APP_SECRET ?? '';
    if (!appId || !appSecret) throw new Error('缺少飞书环境变量');

    const res = await fetch(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    if (!res.ok) throw new Error(`飞书 token ${res.status}`);
    const json = await res.json() as { tenant_access_token?: string; expire?: number };
    if (!json.tenant_access_token) throw new Error('飞书 token 响应异常');

    this.tokenCache = {
      token: json.tenant_access_token,
      expiresAt: Date.now() + (json.expire ?? 7200) * 1000,
    };
    return json.tenant_access_token;
  }
}

interface FeishuEvent {
  event_id?: string;
  summary?: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  created_at?: string;
}