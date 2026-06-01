/**
 * 事件记录器（§3.11 事件采集层）
 *
 * V1.4 实现：写入 events.jsonl（被其他模块调用）
 */
import type { LeadEvent } from '../../core/types.js';
export interface EventRecorderOptions {
    eventsPath?: string;
}
/**
 * 记录一个 lead 事件到 events.jsonl
 */
export declare function recordEvent(event: LeadEvent, opts?: EventRecorderOptions): Promise<void>;
/**
 * 记录 lead 状态变化事件（快捷方法）
 */
export declare function recordStatusChange(cid: string, fromStatus: string | null, toStatus: string, metadata: {
    keyword: string;
    hook_style: string;
    hook_text: string;
    persona: string;
    interaction_time: string;
    days_to_convert?: number;
}): Promise<void>;
/**
 * 记录任务执行事件（快捷方法）
 */
export declare function recordTaskExecuted(cid: string, metadata: {
    keyword: string;
    hook_style: string;
    hook_text: string;
    persona: string;
    interaction_time: string;
}): Promise<void>;
