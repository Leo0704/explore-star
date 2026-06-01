/**
 * 批处理器（10 条/批）
 *
 * analyzeComments 的实际批处理逻辑，暴露给编排器直接调用。
 */
import type { Comment, Lead, BusinessProfile } from '../../core/types.js';
export interface BatchContext {
    profile: BusinessProfile;
    systemPrompt: string;
    userTplStr: string;
    llm: {
        complete(prompt: string): Promise<string>;
    };
    threshold: number;
}
export type BatchRejectedItem = {
    cid: string;
    reason: string;
    raw?: string;
};
/**
 * 分析一批评论（10 条）
 */
export declare function analyzeBatch(comments: Comment[], ctx: BatchContext): Promise<{
    leads: Lead[];
    rejected: BatchRejectedItem[];
    llmErrors: number;
}>;
