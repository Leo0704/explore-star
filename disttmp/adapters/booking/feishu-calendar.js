/**
 * 飞书日历事件监听 BookingProvider
 *
 * 依赖：
 *   - FEISHU_APP_ID, FEISHU_APP_SECRET（与飞书 CRM 共用）
 *   - 飞书日历 ID（FEISHU_CALENDAR_ID）
 *
 * 原理：轮询飞书日历 API，检测新增事件，映射为 BookingEvent。
 */
export class FeishuCalendarBooking {
    tokenCache;
    config;
    baseUrl = 'https://open.feishu.cn/open-apis';
    constructor(config) {
        this.config = config;
    }
    async *watchBookings() {
        let syncToken = '';
        const intervalMs = 60_000; // 60s 轮询
        while (true) {
            try {
                const result = await this.fetchEvents(syncToken);
                for (const event of result.events) {
                    if (event.status !== 'completed')
                        continue; // 只处理已完成事件
                    const bookingEvent = this.parseEvent(event);
                    if (bookingEvent)
                        yield bookingEvent;
                }
                syncToken = result.syncToken;
            }
            catch {
                // 轮询期间出错，静默等待下次重试
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
    }
    async ping() {
        try {
            await this.getToken();
            return true;
        }
        catch {
            return false;
        }
    }
    // -------------------------------------------------------------------------
    // 内部
    // -------------------------------------------------------------------------
    async fetchEvents(syncToken) {
        const token = await this.getToken();
        const params = new URLSearchParams({ page_size: '50' });
        if (syncToken)
            params.set('sync_token', syncToken);
        const res = await fetch(`${this.baseUrl}/calendar/v4/calendars/${this.config.calendarId}/events?${params}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok)
            throw new Error(`飞书日历 ${res.status}`);
        const json = await res.json();
        return {
            events: (json.items ?? []).filter(e => e.event_id && e.start_time),
            syncToken: json.next_sync_token ?? '',
        };
    }
    parseEvent(event) {
        const summary = event.summary ?? '';
        // 从标题解析 cid，格式：探星-{cid}-{日期}
        const match = summary.match(/^探星-(.+?)-\d{4}/);
        if (!match)
            return null;
        return {
            cid: match[1],
            type: 'booked',
            scheduledAt: event.start_time,
            channel: 'feishu_calendar',
            occurredAt: event.created_at ?? new Date().toISOString(),
            metadata: { eventId: event.event_id, summary },
        };
    }
    async getToken() {
        if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
            return this.tokenCache.token;
        }
        const appId = process.env.FEISHU_APP_ID ?? '';
        const appSecret = process.env.FEISHU_APP_SECRET ?? '';
        if (!appId || !appSecret)
            throw new Error('缺少飞书环境变量');
        const res = await fetch(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        });
        if (!res.ok)
            throw new Error(`飞书 token ${res.status}`);
        const json = await res.json();
        if (!json.tenant_access_token)
            throw new Error('飞书 token 响应异常');
        this.tokenCache = {
            token: json.tenant_access_token,
            expiresAt: Date.now() + (json.expire ?? 7200) * 1000,
        };
        return json.tenant_access_token;
    }
}
//# sourceMappingURL=feishu-calendar.js.map