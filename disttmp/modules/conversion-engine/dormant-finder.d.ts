/**
 * 沉默客户发现器（§3.10 再激活：30 天沉默池）
 *
 * V1.4 实现：从 CRM 找"已加微但 30 天无互动"的 lead
 */
import type { Lead, CRMAdapter, ConversionConfig } from '../../core/types.js';
export interface DormantFinderOptions {
    crm: CRMAdapter;
    conversion: ConversionConfig;
}
/**
 * 找沉默 lead（加微后 dormant_days 天无互动，未成交）
 */
export declare function findDormantLeads(opts: DormantFinderOptions): Promise<Lead[]>;
/**
 * 统计沉默客户汇总
 */
export declare function dormantSummary(opts: DormantFinderOptions): Promise<{
    count: number;
    oldestDays: number;
    byPersona: Record<string, number>;
}>;
