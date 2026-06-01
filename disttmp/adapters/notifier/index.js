/**
 * Notifier Adapters 索引
 */
import { ConsoleNotifier } from './console.js';
import { WechatNotifier } from './wechat.js';
import { FeishuWebhookNotifier } from './feishu.js';
import { EmailNotifier } from './email.js';
import { registerNotifier, listNotifiers } from '../registry.js';
export function registerAll() {
    registerNotifier('console', new ConsoleNotifier());
    // 微信（Server 酱）
    if (process.env.WECHAT_SC_KEY) {
        registerNotifier('wechat', new WechatNotifier(process.env.WECHAT_SC_KEY));
    }
    // 飞书 WebHook
    if (process.env.FEISHU_WEBHOOK_URL) {
        registerNotifier('feishu', new FeishuWebhookNotifier(process.env.FEISHU_WEBHOOK_URL));
    }
    // 邮件
    if (process.env.TO_EMAIL && (process.env.SMTP_URL || process.env.SMTP_HOST)) {
        registerNotifier('email', new EmailNotifier(process.env.TO_EMAIL, process.env.SMTP_URL));
    }
    console.log(`[adapters/notifier] 已注册：${listNotifiers().join(', ')}`);
}
export { ConsoleNotifier } from './console.js';
export { WechatNotifier } from './wechat.js';
export { FeishuWebhookNotifier } from './feishu.js';
export { EmailNotifier } from './email.js';
//# sourceMappingURL=index.js.map