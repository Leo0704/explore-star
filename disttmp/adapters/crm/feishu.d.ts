/**
 * 飞书 CRM Adapter（§3.5）
 *
 * 写入飞书多维表（Base）。
 *
 * 依赖：
 *   - 飞书开放平台应用（app_id + app_secret）
 *   - 飞书多维表 table_id
 *   - tenant_access_token 通过 app_id/app_secret 换取
 *
 * V1.4 实现要点：
 *   - 简化为「单条写入」模式（不批量；多维表 batch 写入有 1000 条/次限制）
 *   - 字段映射来自 `business/crm.yaml → field_mapping`
 *   - 缺字段时静默跳过（不报错）
 */
import type { CRMAdapter, Lead, LeadFilter, LeadStatus, SyncResult } from '../../core/types.js';
export declare class FeishuCRM implements CRMAdapter {
    private readonly config;
    private tokenCache?;
    constructor(config: CrmConfig);
    syncLeads(leads: Lead[]): Promise<SyncResult>;
    getLead(cid: string): Promise<Lead | null>;
    updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void>;
    listLeads(filter?: LeadFilter): Promise<Lead[]>;
    ping(): Promise<boolean>;
    private upsertLead;
    private getToken;
    private fieldMap;
}
export interface CrmConfig {
    baseUrl?: string;
    tableId: string;
    appIdEnv: string;
    appSecretEnv: string;
    fieldMapping: Record<string, string>;
}
