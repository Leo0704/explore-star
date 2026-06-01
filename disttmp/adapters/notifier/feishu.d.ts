/**
 * 飞书机器人 WebHook Notifier（实现 Notifier）
 *
 * 依赖：FEISHU_WEBHOOK_URL 环境变量
 * 文档：https://open.feishu.cn/document/server-docs/basic-bot/messages
 */
import type { Notifier, NotificationMessage, SendResult } from '../../core/types.js';
export declare class FeishuWebhookNotifier implements Notifier {
    private readonly webhookUrl;
    readonly name = "feishu";
    constructor(webhookUrl?: string);
    send(message: NotificationMessage): Promise<SendResult>;
    private buildText;
}
