/**
 * CRM 同步模块（§3.5）
 *
 * 从 Lead[] 调 CRMAdapter.syncLeads，错误归档到 data/failed/
 */
import type { CRMAdapter, Lead } from '../../core/types.js';
export interface CrmSyncOptions {
    /** 失败归档目录，默认 data/failed/ */
    failedDir?: string;
    /** 失败文件名前缀，默认 crm-sync */
    failedPrefix?: string;
}
export interface CrmSyncReport {
    total: number;
    synced: number;
    failed: number;
    failedCids: string[];
    errors: Array<{
        cid: string;
        error: string;
    }>;
}
export declare function syncLeads(crm: CRMAdapter, leads: Lead[], opts?: CrmSyncOptions): Promise<CrmSyncReport>;
export declare function runCLI(args: string[]): Promise<void>;
