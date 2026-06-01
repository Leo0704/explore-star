/**
 * 飞书机器人 WebHook Notifier（实现 Notifier）
 *
 * 依赖：FEISHU_WEBHOOK_URL 环境变量
 * 文档：https://open.feishu.cn/document/server-docs/basic-bot/messages
 */

import type { Notifier, NotificationMessage, SendResult } from '../../core/types.js';

interface FeishuMessage {
  msg_type: 'text' | 'interactive';
  content: { text?: string; card?: unknown };
}

export class FeishuWebhookNotifier implements Notifier {
  readonly name = 'feishu';

  constructor(private readonly webhookUrl: string = process.env.FEISHU_WEBHOOK_URL ?? '') {
    if (!this.webhookUrl) throw new Error('FeishuWebhookNotifier 需要 FEISHU_WEBHOOK_URL 环境变量');
  }

  async send(message: NotificationMessage): Promise<SendResult> {
    const body: FeishuMessage = {
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

    const json = await res.json() as { code?: number; msg?: string };
    if (json.code !== 0) {
      return { ok: false, error: json.msg ?? '发送失败' };
    }

    return { ok: true, message_id: String(Date.now()) };
  }

  private buildText(msg: NotificationMessage): string {
    const parts: string[] = [];
    if (msg.title) parts.push(`**${msg.title}**`);
    parts.push(msg.body);
    if (msg.level) parts.push(`\n\n[${msg.level.toUpperCase()}]`);
    if (msg.actions?.length) {
      for (const a of msg.actions) {
        parts.push(`\n• [${a.label}](${a.url})`);
      }
    }
    return parts.join('\n');
  }
}