/**
 * Airtable CRM Adapter（实现 CRMAdapter，Airtable API v0）
 *
 * 依赖：
 *   - AIRTABLE_API_KEY 环境变量
 *   - AIRTABLE_BASE_ID 环境变量
 *   - business/crm.yaml 中配置 tableName + fieldMapping
 */
export class AirtableCRM {
    apiKey;
    baseId;
    tableName;
    fieldMapping;
    baseUrl = 'https://api.airtable.com/v0';
    constructor(config) {
        this.apiKey = process.env.AIRTABLE_API_KEY ?? '';
        if (!this.apiKey)
            throw new Error('AirtableCRM 需要 AIRTABLE_API_KEY 环境变量');
        this.baseId = process.env.AIRTABLE_BASE_ID ?? '';
        if (!this.baseId)
            throw new Error('AirtableCRM 需要 AIRTABLE_BASE_ID 环境变量');
        this.tableName = config.tableName;
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
        const filter = `FIND("${cid}", {${this.fieldMap('cid')}})`;
        const records = await this.queryRecords(filter, 1);
        if (!records.length)
            return null;
        return this.recordToLead(records[0]);
    }
    async updateStatus(cid, status, note) {
        const record = await this.findRecordByCid(cid);
        if (!record)
            throw new Error(`Lead ${cid} not found`);
        const fields = {
            [this.fieldMap('status')]: status,
        };
        if (note)
            fields[this.fieldMap('notes')] = note;
        await this.patchRecord(record.id, fields);
    }
    async listLeads(filter) {
        const formula = this.buildFilter(filter);
        const records = await this.queryRecords(formula, 100);
        return records.map(r => this.recordToLead(r));
    }
    async ping() {
        try {
            const res = await fetch(`${this.baseUrl}/${this.baseId}/${encodeURIComponent(this.tableName)}?maxRecords=1`, {
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
            'Content-Type': 'application/json',
        };
    }
    fieldMap(stdField) {
        return this.fieldMapping?.[stdField] ?? stdField;
    }
    async upsertLead(lead) {
        const existing = await this.findRecordByCid(lead.cid);
        const fields = this.leadToFields(lead);
        if (existing) {
            await this.patchRecord(existing.id, fields);
        }
        else {
            await this.createRecord(fields);
        }
    }
    leadToFields(lead) {
        const fields = {};
        for (const [stdField, airtableField] of Object.entries(this.fieldMapping)) {
            const v = lead[stdField];
            if (v !== undefined && v !== null && v !== '') {
                fields[airtableField] = v;
            }
        }
        return fields;
    }
    async findRecordByCid(cid) {
        const filter = `FIND("${cid}", {${this.fieldMap('cid')}})`;
        const records = await this.queryRecords(filter, 1);
        return records[0] ?? null;
    }
    buildFilter(filter) {
        if (!filter)
            return '';
        const parts = [];
        if (filter.status?.length) {
            const statuses = filter.status.map(s => `"${s}"`).join(',');
            parts.push(`OR(SEARCH({${this.fieldMap('status')}}, [${statuses}]))`);
        }
        if (filter.intent_score_gte !== undefined) {
            parts.push(`{ ${this.fieldMap('intent_score')} } >= ${filter.intent_score_gte}`);
        }
        return parts.join('AND');
    }
    async queryRecords(filterByFormula, maxRecords) {
        const params = new URLSearchParams({ maxRecords: String(maxRecords) });
        if (filterByFormula)
            params.set('filterByFormula', filterByFormula);
        const res = await fetch(`${this.baseUrl}/${this.baseId}/${encodeURIComponent(this.tableName)}?${params}`, {
            headers: this.headers(),
        });
        if (!res.ok)
            throw new Error(`Airtable query ${res.status}: ${await res.text()}`);
        const json = await res.json();
        return json.records ?? [];
    }
    async createRecord(fields) {
        const res = await fetch(`${this.baseUrl}/${this.baseId}/${encodeURIComponent(this.tableName)}`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ fields }),
        });
        if (!res.ok)
            throw new Error(`Airtable create ${res.status}: ${await res.text()}`);
    }
    async patchRecord(recordId, fields) {
        const res = await fetch(`${this.baseUrl}/${this.baseId}/${encodeURIComponent(this.tableName)}/${recordId}`, {
            method: 'PATCH',
            headers: this.headers(),
            body: JSON.stringify({ fields }),
        });
        if (!res.ok)
            throw new Error(`Airtable patch ${res.status}: ${await res.text()}`);
    }
    recordToLead(record) {
        const result = {};
        for (const [airtableField, stdField] of Object.entries(this.fieldMapping)) {
            const v = record.fields[airtableField];
            if (v !== undefined)
                result[stdField] = v;
        }
        return result;
    }
}
//# sourceMappingURL=airtable.js.map