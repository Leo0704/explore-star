/**
 * 事件记录器（§3.11 事件采集层）
 *
 * V1.4 实现：写入 events.jsonl（被其他模块调用）
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
const DEFAULT_EVENTS_PATH = './data/feedback/events.jsonl';
/**
 * 记录一个 lead 事件到 events.jsonl
 */
export async function recordEvent(event, opts = {}) {
    const path = opts.eventsPath ?? DEFAULT_EVENTS_PATH;
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(event) + '\n', 'utf-8');
}
/**
 * 记录 lead 状态变化事件（快捷方法）
 */
export async function recordStatusChange(cid, fromStatus, toStatus, metadata) {
    const event = {
        event: 'lead_status_changed',
        cid,
        from_status: fromStatus,
        to_status: toStatus,
        ...metadata,
    };
    await recordEvent(event);
}
/**
 * 记录任务执行事件（快捷方法）
 */
export async function recordTaskExecuted(cid, metadata) {
    const event = {
        event: 'task_executed',
        cid,
        ...metadata,
    };
    await recordEvent(event);
}
//# sourceMappingURL=event-recorder.js.map