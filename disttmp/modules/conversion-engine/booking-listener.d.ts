/**
 * 预约监听器（§3.10 BookingProvider）
 *
 * V1.4 实现：调 BookingProvider（飞书日历 / webhook / manual）
 * 监听新预约事件 → 自动更新 lead 状态为"已预约"
 */
import type { CRMAdapter } from '../../core/types.js';
export interface BookingListenerOptions {
    crm: CRMAdapter;
    /** 轮询间隔（毫秒，默认 30s） */
    pollIntervalMs?: number;
}
/**
 * 启动预约监听循环，持续监听新预约事件
 */
export declare function watchBookings(opts: BookingListenerOptions): Promise<void>;
/**
 * 手动触发一次预约同步（用于 cron 调用）
 */
export declare function syncBookingsOnce(opts: BookingListenerOptions): Promise<{
    synced: number;
    errors: string[];
}>;
