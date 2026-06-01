/**
 * 通用 WebHook BookingProvider
 *
 * 依赖：BOOKING_WEBHOOK_SECRET 环境变量（可选，用于签名验证）
 *
 * 使用方式：
 *   node dist/adapters/booking/webhook-server.js
 *   业务方在飞书/日历/落地页配置 WebHook URL 指向本服务。
 *
 * 本文件是"接收端"——暴露一个 HTTP handler 供外部调用。
 * watchBookings() 返回队列中的事件。
 */
import type { BookingEvent, BookingProvider } from './base.js';
interface WebhookBookingConfig {
    /** 队列文件路径（默认 ./data/booking-queue.jsonl）*/
    queuePath?: string;
}
/**
 * 通用 WebHook 接收器（内存队列）
 *
 * watchBookings() 返回一个 async iterable，持续产出 WebHook 推送的预约事件。
 * 生产者：外部系统（飞书日历/WebSocket/落地页）调用 /webhook/booking 端点。
 */
export declare class WebhookBooking implements BookingProvider {
    private queue;
    private resolveNext;
    private readonly queuePath;
    constructor(config?: WebhookBookingConfig);
    /**
     * 接收外部 WebHook 调用，enqueue 事件
     * 由 HTTP server（webhook-server.ts）在接收到 POST /webhook/booking 时调用
     */
    enqueue(event: BookingEvent): void;
    watchBookings(): AsyncIterable<BookingEvent>;
    ping(): Promise<boolean>;
}
/**
 * 验证 WebHook 签名（HMAC-SHA256）
 */
export declare function verifyWebhookSignature(body: string, signature: string, secret: string): boolean;
export {};
