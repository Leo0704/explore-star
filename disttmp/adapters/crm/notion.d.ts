/**
 * Notion CRM Adapter（实现 CRMAdapter，Notion Database API v1）
 *
 * 依赖：
 *   - NOTION_API_KEY 环境变量
 *   - business/crm.yaml 中配置 databaseId + fieldMapping
 */
import type { CRMAdapter, Lead, LeadFilter, LeadStatus, SyncResult } from '../../core/types.js';
interface NotionConfig {
    databaseId: string;
    fieldMapping: Record<string, string>;
}
export declare class NotionCRM implements CRMAdapter {
    private readonly apiKey;
    private readonly databaseId;
    private readonly fieldMapping;
    private readonly baseUrl;
    constructor(config: NotionConfig);
    syncLeads(leads: Lead[]): Promise<SyncResult>;
    getLead(cid: string): Promise<Lead | null>;
    updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void>;
    listLeads(filter?: LeadFilter): Promise<Lead[]>;
    ping(): Promise<boolean>;
    private headers;
    private fieldMap;
    private leadToProperties;
    private serializeValue;
    private upsertLead;
    private findPageByCid;
    private buildFilter;
    private queryDatabase;
    private createPage;
    private patchPage;
    private pageToLead;
    private extractPropertyValue;
}
export {};
