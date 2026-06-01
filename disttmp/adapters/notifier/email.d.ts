/**
 * Email Notifier（实现 Notifier，nodemailer SMTP）
 *
 * 依赖：
 *   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS 环境变量
 *   - 或 SMTP_URL（smtp://user:pass@host:port）
 *   - TO_EMAIL（默认通知接收邮箱）
 */
import type { Notifier, NotificationMessage, SendResult } from '../../core/types.js';
export declare class EmailNotifier implements Notifier {
    readonly name = "email";
    private readonly host;
    private readonly port;
    private readonly user;
    private readonly pass;
    private readonly from;
    private readonly to;
    constructor(toEmail?: string, smtpUrl?: string);
    send(message: NotificationMessage): Promise<SendResult>;
    private buildHtml;
}
