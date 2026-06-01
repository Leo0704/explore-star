/**
 * 微信 Notifier（实现 Notifier，Server 酱 / 公众号模板消息）
 *
 * 依赖：
 *   - WECHAT_SC_KEY（Server 酱 SENDKEY）
 *   - 或 WECHAT_TEMPLATE_ID + WECHAT_ACCESS_TOKEN（公众号模板消息）
 *
 * V1 使用 Server 酱（sc.ftqq.com）—— 零配置，即插即用
 */
import type { Notifier, NotificationMessage, SendResult } from '../../core/types.js';
export declare class WechatNotifier implements Notifier {
    private readonly sendKey;
    readonly name = "wechat";
    constructor(sendKey?: string);
    send(message: NotificationMessage): Promise<SendResult>;
    private buildDesp;
}
