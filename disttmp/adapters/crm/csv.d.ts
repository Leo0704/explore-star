/**
 * 本地 CSV CRM Adapter（§3.5）
 *
 * 零配置、开发/调试用。生产推荐用 feishu / notion / airtable。
 *
 * 存储路径：./data/leads.csv
 *
 * CSV 列：所有 Lead 字段 + standard mapping
 */
import type { CRMAdapter, Lead, LeadFilter, SyncResult, LeadStatus } from '../../core/types.js';
export declare class CsvCRM implements CRMAdapter {
    private readonly csvPath;
    constructor(csvPath?: string);
    syncLeads(leads: Lead[]): Promise<SyncResult>;
    getLead(cid: string): Promise<Lead | null>;
    updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void>;
    listLeads(filter?: LeadFilter): Promise<Lead[]>;
    ping(): Promise<boolean>;
    private readAll;
    private writeAll;
}
