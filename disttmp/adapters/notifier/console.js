/**
 * Console Notifier —— 把通知打到 stdout（V1.4 占位实现）
 *
 * V2 可替换为：Wechat (opencli weixin) / Feishu WebHook / Email / Slack
 */
export class ConsoleNotifier {
    name = 'console';
    async send(message) {
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
//# sourceMappingURL=console.js.map