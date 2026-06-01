/**
 * Airtable CRM Adapter（实现 CRMAdapter，Airtable API v0）
 *
 * 依赖：
 *   - AIRTABLE_API_KEY 环境变量
 *   - AIRTABLE_BASE_ID 环境变量
 *   - business/crm.yaml 中配置 tableName + fieldMapping
 */
import type { CRMAdapter, Lead, LeadFilter, LeadStatus, SyncResult } from '../../core/types.js';
interface AirtableConfig {
    tableName: string;
    fieldMapping: Record<string, string>;
}
export declare class AirtableCRM implements CRMAdapter {
    private readonly apiKey;
    private readonly baseId;
    private readonly tableName;
    private readonly fieldMapping;
    private readonly baseUrl;
    constructor(config: AirtableConfig);
    syncLeads(leads: Lead[]): Promise<SyncResult>;
    getLead(cid: string): Promise<Lead | null>;
    updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void>;
    listLeads(filter?: LeadFilter): Promise<Lead[]>;
    ping(): Promise<boolean>;
    private headers;
    private fieldMap;
    private upsertLead;
    private leadToFields;
    private findRecordByCid;
    private buildFilter;
    private queryRecords;
    private createRecord;
    private patchRecord;
    private recordToLead;
}
export {};
