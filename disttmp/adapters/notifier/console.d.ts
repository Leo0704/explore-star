/**
 * Console Notifier —— 把通知打到 stdout（V1.4 占位实现）
 *
 * V2 可替换为：Wechat (opencli weixin) / Feishu WebHook / Email / Slack
 */
import type { Notifier, NotificationMessage, SendResult } from '../../core/types.js';
export declare class ConsoleNotifier implements Notifier {
    readonly name = "console";
    send(message: NotificationMessage): Promise<SendResult>;
}
