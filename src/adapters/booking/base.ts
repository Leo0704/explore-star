/**
 * BookingProvider 接口 + 类型（§13.4 补充）
 *
 * 预约事件监听接口，供转化引擎消费。
 */

import type { Lead, LeadStatus } from '../../core/types.js';

/**
 * 预约事件
 */
export interface BookingEvent {
  /** 关联 lead 的 cid */
  cid: string;
  /** 事件类型 */
  type: 'booked' | 'cancelled' | 'reminded';
  /** 预约时间（ISO 8601）*/
  scheduledAt?: string;
  /** 预约渠道 */
  channel: string;
  /** 原始事件时间 */
  occurredAt: string;
  /** 额外数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 预约提供者
 *
 * 实现：监听预约来源（飞书日历 / WebHook / 手动），产生 BookingEvent 事件流。
 */
export interface BookingProvider {
  /**
   * 启动监听，返回异步事件迭代器。
   * 调用方负责销毁迭代器以停止监听。
   */
  watchBookings(): AsyncIterable<BookingEvent>;

  /**
   * 健康检查
   */
  ping(): Promise<boolean>;
}