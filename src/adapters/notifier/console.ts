/**
 * Console Notifier —— 把通知打到 stdout（V1.4 占位实现）
 *
 * V2 可替换为：Wechat (opencli weixin) / Feishu WebHook / Email / Slack
 */

import type { Notifier, NotificationMessage, SendResult } from '../../core/types.js';

export class ConsoleNotifier implements Notifier {
  readonly name = 'console';

  async send(message: NotificationMessage): Promise<SendResult> {
    const banner = '═'.repeat(60);
    console.log(`\n${banner}`);
    if (message.title) {
      console.log(`📢 ${message.title}`);
    }
    console.log(message.body);
    if (message.actions?.length) {
      console.log('\nActions:');
      for (const a of message.actions) {
        console.log(`  - ${a.label}: ${a.url}`);
      }
    }
    console.log(`${banner}\n`);
    return { ok: true, message_id: `console-${Date.now()}` };
  }
}
