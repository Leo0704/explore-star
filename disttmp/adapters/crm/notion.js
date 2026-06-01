/**
 * Notion CRM Adapter（实现 CRMAdapter，Notion Database API v1）
 *
 * 依赖：
 *   - NOTION_API_KEY 环境变量
 *   - business/crm.yaml 中配置 databaseId + fieldMapping
 */
export class NotionCRM {
    apiKey;
    databaseId;
    fieldMapping;
    baseUrl = 'https://api.notion.com/v1';
    constructor(config) {
        this.apiKey = process.env.NOTION_API_KEY ?? '';
        if (!this.apiKey)
            throw new Error('NotionCRM 需要 NOTION_API_KEY 环境变量');
        this.databaseId = config.databaseId;
        this.fieldMapping = config.fieldMapping;
    }
    async syncLeads(leads) {
        const errors = [];
        let synced = 0;
        for (const lead of leads) {
            try {
                await this.upsertLead(lead);
                synced++;
            }
            catch (e) {
                errors.push({ cid: lead.cid, error: String(e) });
            }
        }
        return { synced, failed: errors.length, errors };
    }
    async getLead(cid) {
        const filter = { property: this.fieldMap('cid'), rich_text: { equals: cid } };
        const res = await this.queryDatabase(filter);
        const page = res.results?.[0];
        if (!page)
            return null;
        return this.pageToLead(page);
    }
    async updateStatus(cid, status, note) {
        const page = await this.findPageByCid(cid);
        if (!page)
            throw new Error(`Lead ${cid} not found`);
        const properties = {
            [this.fieldMap('status')]: { select: { name: status } },
        };
        if (note) {
            properties[this.fieldMap('notes')] = { rich_text: [{ text: { content: note } }] };
        }
        await this.patchPage(page.id, { properties });
    }
    async listLeads(filter) {
        const notionFilter = this.buildFilter(filter ?? {});
        const res = await this.queryDatabase(notionFilter);
        return res.results.map(p => this.pageToLead(p));
    }
    async ping() {
        try {
            const res = await fetch(`${this.baseUrl}/databases/${this.databaseId}`, {
                headers: this.headers(),
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
    // -------------------------------------------------------------------------
    // 内部
    // -------------------------------------------------------------------------
    headers() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
        };
    }
    fieldMap(stdField) {
        return this.fieldMapping?.[stdField] ?? stdField;
    }
    leadToProperties(lead) {
        const props = {};
        for (const [stdField, notionField] of Object.entries(this.fieldMapping)) {
            const v = lead[stdField];
            if (v !== undefined && v !== null && v !== '') {
                props[notionField] = this.serializeValue(v);
            }
        }
        return props;
    }
    serializeValue(v) {
        if (typeof v === 'string')
            return { rich_text: [{ text: { content: v } }] };
        if (typeof v === 'number')
            return { number: v };
        if (typeof v === 'boolean')
            return { checkbox: v };
        if (Array.isArray(v))
            return { rich_text: [{ text: { content: JSON.stringify(v) } }] };
        return { rich_text: [{ text: { content: String(v) } }] };
    }
    async upsertLead(lead) {
        const existing = await this.findPageByCid(lead.cid);
        const properties = this.leadToProperties(lead);
        if (existing) {
            await this.patchPage(existing.id, { properties });
        }
        else {
            properties[this.fieldMap('cid')] = { rich_text: [{ text: { content: lead.cid } }] };
            await this.createPage(properties);
        }
    }
    async findPageByCid(cid) {
        const res = await this.queryDatabase({
            property: this.fieldMap('cid'),
            rich_text: { equals: cid },
        });
        const first = res.results?.[0];
        return first ? { id: first.id ?? '' } : null;
    }
    buildFilter(filter) {
        if (!filter)
            return {};
        const conditions = [];
        if (filter.status) {
            const statuses = filter.status;
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
    async queryDatabase(filter) {
        const body = {
            database_id: this.databaseId,
            page_size: 100,
        };
        if (Object.keys(filter).length > 0)
            body.filter = filter;
        const res = await fetch(`${this.baseUrl}/databases/query`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(body),
        });
        if (!res.ok)
            throw new Error(`Notion query ${res.status}: ${await res.text()}`);
        const json = await res.json();
        return { results: json.results ?? [] };
    }
    async createPage(properties) {
        const res = await fetch(`${this.baseUrl}/pages`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ parent: { database_id: this.databaseId }, properties }),
        });
        if (!res.ok)
            throw new Error(`Notion create page ${res.status}: ${await res.text()}`);
    }
    async patchPage(pageId, body) {
        const res = await fetch(`${this.baseUrl}/pages/${pageId}`, {
            method: 'PATCH',
            headers: this.headers(),
            body: JSON.stringify(body),
        });
        if (!res.ok)
            throw new Error(`Notion patch page ${res.status}: ${await res.text()}`);
    }
    pageToLead(page) {
        const p = page;
        const props = p.properties ?? {};
        const result = {};
        for (const [notionField, stdField] of Object.entries(this.fieldMapping)) {
            const prop = props[notionField];
            if (!prop)
                continue;
            result[stdField] = this.extractPropertyValue(prop);
        }
        return result;
    }
    extractPropertyValue(prop) {
        const p = prop;
        switch (p.type) {
            case 'rich_text': return p.rich_text?.[0]?.text?.content ?? '';
            case 'number': return p.number;
            case 'checkbox': return p.checkbox;
            case 'select': return p.select?.name;
            default: return String(prop);
        }
    }
}
//# sourceMappingURL=notion.js.map