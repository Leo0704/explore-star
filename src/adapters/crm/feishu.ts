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

interface FeishuTenantToken {
  tenant_access_token: string;
  expire: number;
}

export class FeishuCRM implements CRMAdapter {
  private tokenCache?: { token: string; expiresAt: number };

  constructor(private readonly config: CrmConfig) {}

  async syncLeads(leads: Lead[]): Promise<SyncResult> {
    const token = await this.getToken();
    const errors: Array<{ cid: string; error: string }> = [];
    let synced = 0;

    for (const lead of leads) {
      try {
        await this.upsertLead(lead, token);
        synced++;
      } catch (e) {
        errors.push({ cid: lead.cid, error: String(e) });
      }
    }

    return { synced, failed: errors.length, errors };
  }

  async getLead(cid: string): Promise<Lead | null> {
    // 飞书多维表没有"按 cid 查询"——需用 search 接口
    // V1.4 简化：返回 null（业务方通过 status filter 拉列表）
    return null;
  }

  async updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void> {
    // V1.4 简化：仅更新 status 字段（不传其他字段）
    const token = await this.getToken();
    await fetch(`${this.config.baseUrl}/open-apis/bitable/v1/apps/${this.config.tableId}/records`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: [{
          fields: {
            [this.fieldMap('status')]: status,
            ...(note ? { [this.fieldMap('notes')]: note } : {}),
          },
        }],
      }),
    });
  }

  async listLeads(filter?: LeadFilter): Promise<Lead[]> {
    // V1.4 简化：飞书多维表 list 不实现，业务方先 sync 到 CSV 再分析
    // V2: 实现飞书 search API
    return [];
  }

  async ping(): Promise<boolean> {
    try {
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private async upsertLead(lead: Lead, token: string): Promise<void> {
    const fields: Record<string, unknown> = {};
    for (const [stdField, feishuField] of Object.entries(this.config.fieldMapping)) {
      const v = (lead as unknown as Record<string, unknown>)[stdField];
      if (v !== undefined && v !== null && v !== '') {
        fields[feishuField] = v;
      }
    }

    const res = await fetch(
      `${this.config.baseUrl}/open-apis/bitable/v1/apps/${this.config.tableId}/records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: [{ fields }] }),
      },
    );
    if (!res.ok) {
      throw new Error(`飞书 API ${res.status}: ${await res.text()}`);
    }
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }

    const appId = process.env[this.config.appIdEnv];
    const appSecret = process.env[this.config.appSecretEnv];
    if (!appId || !appSecret) {
      throw new Error(`缺少环境变量 ${this.config.appIdEnv} 或 ${this.config.appSecretEnv}`);
    }

    const res = await fetch(`${this.config.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    if (!res.ok) throw new Error(`飞书 token API ${res.status}`);
    const json = (await res.json()) as FeishuTenantToken;
    if (!json.tenant_access_token) throw new Error('飞书 token 响应缺少 tenant_access_token');

    this.tokenCache = {
      token: json.tenant_access_token,
      expiresAt: Date.now() + json.expire * 1000,
    };
    return json.tenant_access_token;
  }

  private fieldMap(stdField: string): string {
    return this.config.fieldMapping?.[stdField] ?? stdField;
  }
}

// ---------------------------------------------------------------------------
// 类型扩展（FeishuCRM 专用）
// ---------------------------------------------------------------------------

export interface CrmConfig {
  baseUrl?: string;           // 默认 https://open.feishu.cn
  tableId: string;
  appIdEnv: string;           // 环境变量名
  appSecretEnv: string;       // 环境变量名
  fieldMapping: Record<string, string>;
}
