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

export class AirtableCRM implements CRMAdapter {
  private readonly apiKey: string;
  private readonly baseId: string;
  private readonly tableName: string;
  private readonly fieldMapping: Record<string, string>;
  private readonly baseUrl = 'https://api.airtable.com/v0';

  constructor(config: AirtableConfig) {
    this.apiKey = process.env.AIRTABLE_API_KEY ?? '';
    if (!this.apiKey) throw new Error('AirtableCRM 需要 AIRTABLE_API_KEY 环境变量');
    this.baseId = process.env.AIRTABLE_BASE_ID ?? '';
    if (!this.baseId) throw new Error('AirtableCRM 需要 AIRTABLE_BASE_ID 环境变量');
    this.tableName = config.tableName;
    this.fieldMapping = config.fieldMapping;
  }

  async syncLeads(leads: Lead[]): Promise<SyncResult> {
    const errors: Array<{ cid: string; error: string }> = [];
    let synced = 0;

    for (const lead of leads) {
      try {
        await this.upsertLead(lead);
        synced++;
      } catch (e) {
        errors.push({ cid: lead.cid, error: String(e) });
      }
    }

    return { synced, failed: errors.length, errors };
  }

  async getLead(cid: string): Promise<Lead | null> {
    const filter = `FIND("${cid}", {${this.fieldMap('cid')}})`;
    const records = await this.queryRecords(filter, 1);
    if (!records.length) return null;
    return this.recordToLead(records[0]);
  }

  async updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void> {
    const record = await this.findRecordByCid(cid);
    if (!record) throw new Error(`Lead ${cid} not found`);

    const fields: Record<string, unknown> = {
      [this.fieldMap('status')]: status,
    };
    if (note) fields[this.fieldMap('notes')] = escapeFormula(note);

    await this.patchRecord(record.id, fields);
  }

  async updateLeadFields(cid: string, fields: Partial<Lead>): Promise<void> {
    const record = await this.findRecordByCid(cid);
    if (!record) throw new Error(`Lead ${cid} not found`);

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      const target = this.fieldMapping?.[k] ?? k;
      patch[target] = typeof v === 'string' ? escapeFormula(v) : v;
    }
    patch[this.fieldMap('updated_at')] = new Date().toISOString();

    await this.patchRecord(record.id, patch);
  }

  async listLeads(filter?: LeadFilter): Promise<Lead[]> {
    const formula = this.buildFilter(filter);
    const records = await this.queryRecords(formula, 100);
    return records.map(r => this.recordToLead(r));
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/${this.baseId}/${encodeURIComponent(this.tableName)}?maxRecords=1`, {
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private fieldMap(stdField: string): string {
    return this.fieldMapping?.[stdField] ?? stdField;
  }

  private async upsertLead(lead: Lead): Promise<void> {
    const existing = await this.findRecordByCid(lead.cid);
    const fields = this.leadToFields(lead);

    if (existing) {
      await this.patchRecord(existing.id, fields);
    } else {
      await this.createRecord(fields);
    }
  }

  private leadToFields(lead: Lead): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const [stdField, airtableField] of Object.entries(this.fieldMapping)) {
      const v = (lead as unknown as Record<string, unknown>)[stdField];
      if (v === undefined || v === null || v === '') continue;
      // CWE-1236 防护: string 字段首字符为公式触发符时前置单引号
      // (number / boolean / 对象类型不需要转义)
      fields[airtableField] = typeof v === 'string' ? escapeFormula(v) : v;
    }
    return fields;
  }

  private async findRecordByCid(cid: string): Promise<{ id: string } | null> {
    const filter = `FIND("${cid}", {${this.fieldMap('cid')}})`;
    const records = await this.queryRecords(filter, 1);
    return records[0] ?? null;
  }

  private buildFilter(filter?: LeadFilter): string {
    if (!filter) return '';
    const parts: string[] = [];

    if (filter.status?.length) {
      const statuses = filter.status.map(s => `"${s}"`).join(',');
      parts.push(`OR(SEARCH({${this.fieldMap('status')}}, [${statuses}]))`);
    }

    if (filter.intent_score_gte !== undefined) {
      parts.push(`{ ${this.fieldMap('intent_score')} } >= ${filter.intent_score_gte}`);
    }

    return parts.join('AND');
  }

  private async queryRecords(filterByFormula: string, maxRecords: number): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
    const params = new URLSearchParams({ maxRecords: String(maxRecords) });
    if (filterByFormula) params.set('filterByFormula', filterByFormula);

    const res = await fetch(`${this.baseUrl}/${this.baseId}/${encodeURIComponent(this.tableName)}?${params}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Airtable query ${res.status}: ${await res.text()}`);
    const json = await res.json() as { records: Array<{ id: string; fields: Record<string, unknown> }> };
    return json.records ?? [];
  }

  private async createRecord(fields: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.baseUrl}/${this.baseId}/${encodeURIComponent(this.tableName)}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Airtable create ${res.status}: ${await res.text()}`);
  }

  private async patchRecord(recordId: string, fields: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.baseUrl}/${this.baseId}/${encodeURIComponent(this.tableName)}/${recordId}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Airtable patch ${res.status}: ${await res.text()}`);
  }

  private recordToLead(record: { fields: Record<string, unknown> }): Lead {
    const result: Record<string, unknown> = {};
    for (const [airtableField, stdField] of Object.entries(this.fieldMapping)) {
      const v = record.fields[airtableField];
      if (v !== undefined) result[stdField] = v;
    }
    return result as unknown as Lead;
  }
}

// ---------------------------------------------------------------------------
// 工具：Airtable 字段转义（CWE-1236 formula injection 防御）
// ---------------------------------------------------------------------------

function escapeFormula(s: string): string {
  // Airtable web UI 打开 formula 字段时,首字符 =/+/-/@/TAB/CR 会触发公式求值;
  // 前置单引号可强制视为字面量。API 端本身不会求值,但作为防御性写。
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    return "'" + s;
  }
  return s;
}