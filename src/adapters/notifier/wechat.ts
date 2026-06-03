import type { Notifier, NotificationMessage, SendResult } from '../../core/types.js';

export class WechatNotifier implements Notifier {
  readonly name = 'wechat';

  constructor(private readonly sendKey: string = process.env.WECHAT_SC_KEY ?? '') {
    if (!this.sendKey) throw new Error('WechatNotifier 需要 WECHAT_SC_KEY 环境变量（Server 酱 SENDKEY）');
  }

  async send(message: NotificationMessage): Promise<SendResult> {
    const text = [message.title, message.body].filter(Boolean).join('\n\n');
    const url = `https://sc.ftqq.com/${this.sendKey}.send`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        text,
        desp: this.buildDesp(message),
      }).toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Server 酱 ${res.status}: ${errText}` };
    }

    const json = await res.json() as { errno?: number; errmsg?: string; serial?: string };
    if (json.errno !== 0) {
      return { ok: false, error: json.errmsg ?? '发送失败' };
    }

    return { ok: true, message_id: json.serial };
  }

  private buildDesp(msg: NotificationMessage): string {
    let desp = msg.body;
    if (msg.actions?.length) {
      desp += '\n\n---\n';
      for (const a of msg.actions) {
        desp += `\n[${a.label}](${a.url})`;
      }
    }
    return desp;
  }
}