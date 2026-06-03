import type { Notifier, NotificationMessage, SendResult } from '../../core/types.js';

export class EmailNotifier implements Notifier {
  readonly name = 'email';

  private readonly host: string;
  private readonly port: number;
  private readonly user: string;
  private readonly pass: string;
  private readonly from: string;
  private readonly to: string;

  constructor(
    toEmail: string = process.env.TO_EMAIL ?? '',
    smtpUrl: string = process.env.SMTP_URL ?? '',
  ) {
    if (!toEmail) throw new Error('EmailNotifier 需要 TO_EMAIL 环境变量');
    this.to = toEmail;
    this.from = process.env.SMTP_FROM ?? toEmail;

    if (smtpUrl) {
      const u = new URL(smtpUrl);
      this.host = u.hostname;
      this.port = parseInt(u.port) || 587;
      this.user = u.username;
      this.pass = u.password;
    } else {
      this.host = process.env.SMTP_HOST ?? 'localhost';
      this.port = parseInt(process.env.SMTP_PORT ?? '587');
      this.user = process.env.SMTP_USER ?? '';
      this.pass = process.env.SMTP_PASS ?? '';
    }
  }

  async send(message: NotificationMessage): Promise<SendResult> {
    const subject = message.title ?? '探星通知';
    const text = message.body;
    const html = this.buildHtml(message);

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.pass}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: this.to,
        subject,
        text,
        html,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { ok: false, error: `Email API ${resp.status}: ${errText}` };
    }

    const json = await resp.json() as { id?: string; error?: string };
    if (json.error) return { ok: false, error: json.error };

    return { ok: true, message_id: json.id };
  }

  private buildHtml(msg: NotificationMessage): string {
    let html = `<p>${msg.body.replace(/\n/g, '<br>')}</p>`;
    if (msg.actions?.length) {
      html += '<ul>';
      for (const a of msg.actions) {
        html += `<li><a href="${a.url}">${a.label}</a></li>`;
      }
      html += '</ul>';
    }
    return html;
  }
}