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
    return null;
  }

  async updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void> {
    const token = await this.getToken();
    const recordId = await this.findRecordIdByCid(cid, token);
    if (!recordId) {
      throw new Error(`飞书未找到 cid=${cid} 对应的记录，无法更新 status`);
    }

    const fields: Record<string, unknown> = {
      [this.fieldMap('status')]: status,
      ...(note ? { [this.fieldMap('notes')]: note } : {}),
    };

    const res = await fetch(`${this.tableBase}/records/${recordId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      throw new Error(`飞书更新失败 ${res.status}: ${await res.text()}`);
    }
  }

  async updateLeadFields(cid: string, fields: Partial<Lead>): Promise<void> {
    const token = await this.getToken();
    const recordId = await this.findRecordIdByCid(cid, token);
    if (!recordId) {
      throw new Error(`飞书未找到 cid=${cid} 对应的记录，无法更新字段`);
    }

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      const target = this.fieldMap(k);
      patch[target] = v;
    }
    patch[this.fieldMap('updated_at')] = new Date().toISOString();

    const res = await fetch(`${this.tableBase}/records/${recordId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: patch }),
    });
    if (!res.ok) {
      throw new Error(`飞书更新字段失败 ${res.status}: ${await res.text()}`);
    }
  }

  async listLeads(filter?: LeadFilter): Promise<Lead[]> {
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

  private async upsertLead(lead: Lead, token: string): Promise<void> {
    const fields: Record<string, unknown> = {};
    for (const [stdField, feishuField] of Object.entries(this.config.fieldMapping)) {
      const v = (lead as unknown as Record<string, unknown>)[stdField];
      if (v !== undefined && v !== null && v !== '') {
        fields[feishuField] = v;
      }
    }

    const existing = await this.findRecordIdByCid(lead.cid, token);

    if (existing) {
      const patchRes = await fetch(
        `${this.tableBase}/records/${existing}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields }),
        },
      );
      if (!patchRes.ok) {
        throw new Error(`飞书更新失败 ${patchRes.status}: ${await patchRes.text()}`);
      }
    } else {
      const postRes = await fetch(
        `${this.tableBase}/records`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ records: [{ fields }] }),
        },
      );
      if (!postRes.ok) {
        throw new Error(`飞书新增失败 ${postRes.status}: ${await postRes.text()}`);
      }
    }
  }

  private async findRecordIdByCid(cid: string, token: string): Promise<string | null> {
    const cidField = this.config.fieldMapping['cid'] ?? 'cid';
    const searchRes = await fetch(
      `${this.tableBase}/records/search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            conjunction: 'and',
            conditions: [{
              field_name: cidField,
              operator: 'is',
              value: [cid],
            }],
          },
          page_size: 1,
        }),
      },
    );
    if (!searchRes.ok) {
      throw new Error(`飞书查询失败 ${searchRes.status}: ${await searchRes.text()}`);
    }
    const searchData = await searchRes.json() as { data?: { items?: Array<{ record_id: string }> } };
    return searchData?.data?.items?.[0]?.record_id ?? null;
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

    const res = await fetch(`${this.feishuBase}/open-apis/auth/v3/tenant_access_token/internal`, {
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

  private get feishuBase(): string {
    return this.config.baseUrl || 'https://open.feishu.cn';
  }

  private get appBase(): string {
    return `${this.feishuBase}/open-apis/bitable/v1/apps/${this.config.appToken}`;
  }

  private get tableBase(): string {
    return `${this.appBase}/tables/${this.config.tableId}`;
  }
}

export interface CrmConfig {
  baseUrl?: string;
  appToken: string;
  tableId: string;
  appIdEnv: string;
  appSecretEnv: string;
  fieldMapping: Record<string, string>;
}
