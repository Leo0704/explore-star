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
export class WebhookBooking implements BookingProvider {
  private queue: BookingEvent[] = [];
  private resolveNext: ((event: BookingEvent) => void) | null = null;
  private readonly queuePath: string;

  constructor(config: WebhookBookingConfig = {}) {
    this.queuePath = config.queuePath ?? './data/booking-queue.jsonl';
  }

  /**
   * 接收外部 WebHook 调用，enqueue 事件
   * 由 HTTP server（webhook-server.ts）在接收到 POST /webhook/booking 时调用
   */
  enqueue(event: BookingEvent): void {
    this.queue.push(event);
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve(event);
    }
  }

  async *watchBookings(): AsyncIterable<BookingEvent> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else {
        yield await new Promise<BookingEvent>(resolve => {
          this.resolveNext = resolve;
        });
      }
    }
  }

  async ping(): Promise<boolean> {
    return true; // 内存队列始终可用
  }
}

/**
 * 验证 WebHook 签名（HMAC-SHA256）
 */
export function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  // 简化实现：生产环境应使用 crypto.createHmac
  const { createHmac } = require('node:crypto') as { createHmac: Function };
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  return expected === signature;
}