/**
 * 沉默客户再激活（§3.10 再激活话术生成 + 推送）
 *
 * V1.4 实现：
 *   - 生成个性化再激活话术（用 conversion.message_template + RAG）
 *   - 推送并更新 lead 状态
 */
import type { Lead, CRMAdapter, ConversionConfig } from '../../core/types.js';
export interface ReactivateOptions {
    crm: CRMAdapter;
    conversion: ConversionConfig;
}
interface ReactivateResult {
    cid: string;
    nickname: string;
    success: boolean;
    reason: string;
}
/**
 * 再激活单个 lead（根据 message_template 生成话术）
 */
export declare function reactivateLead(lead: Lead, opts: ReactivateOptions): Promise<ReactivateResult>;
/**
 * 批量再激活沉默客户
 */
export declare function reactivateDormantPool(opts: ReactivateOptions): Promise<ReactivateResult[]>;
export {};
