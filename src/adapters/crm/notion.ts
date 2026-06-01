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

export class NotionCRM implements CRMAdapter {
  private readonly apiKey: string;
  private readonly databaseId: string;
  private readonly fieldMapping: Record<string, string>;
  private readonly baseUrl = 'https://api.notion.com/v1';

  constructor(config: NotionConfig) {
    this.apiKey = process.env.NOTION_API_KEY ?? '';
    if (!this.apiKey) throw new Error('NotionCRM 需要 NOTION_API_KEY 环境变量');
    this.databaseId = config.databaseId;
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
    const filter = { property: this.fieldMap('cid'), rich_text: { equals: cid } };
    const res = await this.queryDatabase(filter);
    const page = res.results?.[0];
    if (!page) return null;
    return this.pageToLead(page);
  }

  async updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void> {
    const page = await this.findPageByCid(cid);
    if (!page) throw new Error(`Lead ${cid} not found`);

    const properties: Record<string, unknown> = {
      [this.fieldMap('status')]: { select: { name: status } },
    };
    if (note) {
      properties[this.fieldMap('notes')] = { rich_text: [{ text: { content: note } }] };
    }

    await this.patchPage(page.id, { properties });
  }

  async listLeads(filter?: LeadFilter): Promise<Lead[]> {
    const notionFilter = this.buildFilter(filter ?? {});
    const res = await this.queryDatabase(notionFilter);
    return res.results.map(p => this.pageToLead(p));
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/databases/${this.databaseId}`, {
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
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };
  }

  private fieldMap(stdField: string): string {
    return this.fieldMapping?.[stdField] ?? stdField;
  }

  private leadToProperties(lead: Lead): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    for (const [stdField, notionField] of Object.entries(this.fieldMapping)) {
      const v = (lead as unknown as Record<string, unknown>)[stdField];
      if (v !== undefined && v !== null && v !== '') {
        props[notionField] = this.serializeValue(v);
      }
    }
    return props;
  }

  private serializeValue(v: unknown): unknown {
    if (typeof v === 'string') return { rich_text: [{ text: { content: v } }] };
    if (typeof v === 'number') return { number: v };
    if (typeof v === 'boolean') return { checkbox: v };
    if (Array.isArray(v)) return { rich_text: [{ text: { content: JSON.stringify(v) } }] };
    return { rich_text: [{ text: { content: String(v) } }] };
  }

  private async upsertLead(lead: Lead): Promise<void> {
    const existing = await this.findPageByCid(lead.cid);
    const properties = this.leadToProperties(lead);

    if (existing) {
      await this.patchPage(existing.id, { properties });
    } else {
      properties[this.fieldMap('cid')] = { rich_text: [{ text: { content: lead.cid } }] };
      await this.createPage(properties);
    }
  }

  private async findPageByCid(cid: string): Promise<{ id: string } | null> {
    const res = await this.queryDatabase({
      property: this.fieldMap('cid'),
      rich_text: { equals: cid },
    });
    const first = res.results?.[0] as { id?: string } | undefined;
    return first ? { id: first.id ?? '' } : null;
  }

  private buildFilter(filter: LeadFilter | undefined): Record<string, unknown> {
    if (!filter) return {};
    const conditions: Array<Record<string, unknown>> = [];

    if (filter.status) {
      const statuses = filter.status as LeadStatus[];
      conditions.push({
        or: statuses.map(s => ({
          property: this.fieldMap('status'),
          select: { equals: s },
        })),
      });
    }

    if (filter.intent_score_gte !== undefined) {
      conditions.push({
        property: this.fieldMap('intent_score'),
        number: { greater_than_or_equal_to: filter.intent_score_gte },
      });
    }

    return conditions.length > 0
      ? { and: conditions }
      : {};
  }

  private async queryDatabase(filter: Record<string, unknown>): Promise<{ results: unknown[] }> {
    const body: Record<string, unknown> = {
      database_id: this.databaseId,
      page_size: 100,
    };
    if (Object.keys(filter).length > 0) body.filter = filter;

    const res = await fetch(`${this.baseUrl}/databases/query`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion query ${res.status}: ${await res.text()}`);
    const json = await res.json() as { results?: unknown[] };
    return { results: json.results ?? [] };
  }

  private async createPage(properties: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.baseUrl}/pages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ parent: { database_id: this.databaseId }, properties }),
    });
    if (!res.ok) throw new Error(`Notion create page ${res.status}: ${await res.text()}`);
  }

  private async patchPage(pageId: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.baseUrl}/pages/${pageId}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion patch page ${res.status}: ${await res.text()}`);
  }

  private pageToLead(page: unknown): Lead {
    const p = page as { properties?: Record<string, unknown> };
    const props = p.properties ?? {};
    const result: Record<string, unknown> = {};

    for (const [notionField, stdField] of Object.entries(this.fieldMapping)) {
      const prop = props[notionField];
      if (!prop) continue;
      result[stdField] = this.extractPropertyValue(prop);
    }

    return result as unknown as Lead;
  }

  private extractPropertyValue(prop: unknown): unknown {
    const p = prop as { type?: string; rich_text?: Array<{ text?: { content?: string } }>; number?: number; checkbox?: boolean; select?: { name?: string } };
    switch (p.type) {
      case 'rich_text': return p.rich_text?.[0]?.text?.content ?? '';
      case 'number': return p.number;
      case 'checkbox': return p.checkbox;
      case 'select': return p.select?.name;
      default: return String(prop);
    }
  }
}