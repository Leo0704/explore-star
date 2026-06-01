/**
 * 钩子审核模块（§3.6.5 可选钩子审核模式）
 *
 * 读取 config/hook_review 字段，true 时把 task 写入飞书/微信等多维表
 * 人工标记后再执行
 */
import type { Task } from './index.js';
export interface HookReviewResult {
    approved: boolean;
    modified_hook?: string;
    reason?: string;
}
/**
 * 钩子审核模式
 * V1 实现：直接批准（mock），留接口便于后续升级
 */
export declare function reviewHook(task: Task, reviewConfig?: boolean): Promise<HookReviewResult>;
/**
 * 检查任务是否需要审核
 */
export declare function needsReview(task: Task, reviewConfig: boolean): boolean;
/**
 * 生成审核备注（用于多维表展示）
 */
export declare function generateReviewNote(task: Task): string;
