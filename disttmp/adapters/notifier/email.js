/**
 * Email Notifier（实现 Notifier，nodemailer SMTP）
 *
 * 依赖：
 *   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS 环境变量
 *   - 或 SMTP_URL（smtp://user:pass@host:port）
 *   - TO_EMAIL（默认通知接收邮箱）
 */
export class EmailNotifier {
    name = 'email';
    host;
    port;
    user;
    pass;
    from;
    to;
    constructor(toEmail = process.env.TO_EMAIL ?? '', smtpUrl = process.env.SMTP_URL ?? '') {
        if (!toEmail)
            throw new Error('EmailNotifier 需要 TO_EMAIL 环境变量');
        this.to = toEmail;
        this.from = process.env.SMTP_FROM ?? toEmail;
        if (smtpUrl) {
            const u = new URL(smtpUrl);
            this.host = u.hostname;
            this.port = parseInt(u.port) || 587;
            this.user = u.username;
            this.pass = u.password;
        }
        else {
            this.host = process.env.SMTP_HOST ?? 'localhost';
            this.port = parseInt(process.env.SMTP_PORT ?? '587');
            this.user = process.env.SMTP_USER ?? '';
            this.pass = process.env.SMTP_PASS ?? '';
        }
    }
    async send(message) {
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
        const json = await resp.json();
        if (json.error)
            return { ok: false, error: json.error };
        return { ok: true, message_id: json.id };
    }
    buildHtml(msg) {
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
//# sourceMappingURL=email.js.map