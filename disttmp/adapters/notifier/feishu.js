/**
 * 飞书机器人 WebHook Notifier（实现 Notifier）
 *
 * 依赖：FEISHU_WEBHOOK_URL 环境变量
 * 文档：https://open.feishu.cn/document/server-docs/basic-bot/messages
 */
export class FeishuWebhookNotifier {
    webhookUrl;
    name = 'feishu';
    constructor(webhookUrl = process.env.FEISHU_WEBHOOK_URL ?? '') {
        this.webhookUrl = webhookUrl;
        if (!this.webhookUrl)
            throw new Error('FeishuWebhookNotifier 需要 FEISHU_WEBHOOK_URL 环境变量');
    }
    async send(message) {
        const body = {
            msg_type: 'text',
            content: { text: this.buildText(message) },
        };
        const res = await fetch(this.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errText = await res.text();
            return { ok: false, error: `飞书 WebHook ${res.status}: ${errText}` };
        }
        const json = await res.json();
        if (json.code !== 0) {
            return { ok: false, error: json.msg ?? '发送失败' };
        }
        return { ok: true, message_id: String(Date.now()) };
    }
    buildText(msg) {
        const parts = [];
        if (msg.title)
            parts.push(`**${msg.title}**`);
        parts.push(msg.body);
        if (msg.level)
            parts.push(`\n\n[${msg.level.toUpperCase()}]`);
        if (msg.actions?.length) {
            for (const a of msg.actions) {
                parts.push(`\n• [${a.label}](${a.url})`);
            }
        }
        return parts.join('\n');
    }
}
//# sourceMappingURL=feishu.js.map