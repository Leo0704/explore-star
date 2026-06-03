import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import type { CRMAdapter, Lead, LeadFilter, SyncResult, LeadStatus } from '../../core/types.js';

const COLUMNS: Array<keyof Lead> = [
  'cid', 'source', 'aweme_id', 'video_url', 'video_desc', 'keyword',
  'nickname', 'user_signature', 'follower_count', 'user_uid',
  'comment_text', 'comment_digg_count', 'comment_create_time',
  'is_target_persona', 'persona', 'pain_point', 'intent_score', 'buying_stage',
  'suggested_reply_hook', 'suggested_dm_hook',
  'status', 'last_task_executed_at', 'last_task_result', 'last_response_text',
  'execution_count', 'response_count',
  'wechat_added_at', 'booked_at', 'closed_at', 'revenue', 'last_interaction_at',
  'created_at', 'updated_at', 'notes',
  'status_history', 'opt_out', 'hook_style', 'source_keyword',
  'source_video_id', 'detected_at', 'custom_fields',
];

export class CsvCRM implements CRMAdapter {
  constructor(private readonly csvPath: string = './data/leads.csv') {}

  async syncLeads(leads: Lead[]): Promise<SyncResult> {
    const errors: Array<{ cid: string; error: string }> = [];
    let synced = 0;
    try {
      const existing = await this.readAll();
      const byCid = new Map(existing.map(l => [l.cid, l]));

      for (const lead of leads) {
        byCid.set(lead.cid, lead);
        synced++;
      }

      await this.writeAll([...byCid.values()]);
    } catch (e) {
      const err = String(e);
      for (const lead of leads) {
        errors.push({ cid: lead.cid, error: err });
      }
      synced = 0;
    }
    return { synced, failed: errors.length, errors };
  }

  async getLead(cid: string): Promise<Lead | null> {
    const all = await this.readAll();
    return all.find(l => l.cid === cid) ?? null;
  }

  async updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void> {
    const all = await this.readAll();
    const lead = all.find(l => l.cid === cid);
    if (!lead) throw new Error(`Lead ${cid} not found`);
    const from = lead.status;
    lead.status = status;
    lead.status_history.push({
      from, to: status, at: new Date().toISOString(), note,
    });
    lead.updated_at = new Date().toISOString();
    await this.writeAll(all);
  }

  async updateLeadFields(cid: string, fields: Partial<Lead>): Promise<void> {
    const all = await this.readAll();
    const lead = all.find(l => l.cid === cid);
    if (!lead) throw new Error(`Lead ${cid} not found`);
    Object.assign(lead, fields);
    lead.updated_at = new Date().toISOString();
    await this.writeAll(all);
  }

  async listLeads(filter?: LeadFilter): Promise<Lead[]> {
    let all = await this.readAll();
    if (!filter) return all;

    if (filter.status) {
      const s = new Set(filter.status);
      all = all.filter(l => s.has(l.status));
    }
    if (filter.persona) {
      const p = new Set(filter.persona);
      all = all.filter(l => p.has(l.persona));
    }
    if (filter.intent_score_gte !== undefined) {
      const min = filter.intent_score_gte;
      all = all.filter(l => l.intent_score >= min);
    }
    if (filter.created_after) {
      const after = filter.created_after;
      all = all.filter(l => l.created_at >= after);
    }
    if (filter.has_open_task) {
      const open: LeadStatus[] = ['新发现', '已关注', '已互动', '已加好友', '已加微'];
      all = all.filter(l => open.includes(l.status));
    }
    return all;
  }

  async ping(): Promise<boolean> {
    try {
      await this.readAll();
      return true;
    } catch {
      return false;
    }
  }

  private async readAll(): Promise<Lead[]> {
    try {
      const raw = await readFile(this.csvPath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      if (lines.length < 2) return [];
      const header = lines[0].split(',');
      return lines.slice(1).map(line => {
        const values = parseCsvLine(line);
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < header.length; i++) {
          obj[header[i]] = (values[i] ?? '').replace(/\\n/g, '\n');
        }
        return obj as unknown as Lead;
      });
    } catch (e: any) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  private async writeAll(leads: Lead[]): Promise<void> {
    await mkdir(dirname(this.csvPath), { recursive: true });
    const header = COLUMNS.join(',');
    const lines = leads.map(l => COLUMNS.map(c => {
      const v = l[c];
      if (v === undefined || v === null) return '';
      if (c === 'custom_fields' || c === 'status_history') return csvField(JSON.stringify(v));
      return csvField(String(v));
    }).join(','));
    await writeFile(this.csvPath, [header, ...lines].join('\n'), 'utf-8');
  }
}

function csvField(s: string): string {
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  s = s.replace(/\n/g, '\\n');
  if (s.includes(',') || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0, cur = '', inQuote = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (ch === '"') { inQuote = false; i++; continue; }
      cur += ch; i++;
    } else {
      if (ch === '"') { inQuote = true; i++; continue; }
      if (ch === ',') { out.push(cur); cur = ''; i++; continue; }
      cur += ch; i++;
    }
  }
  out.push(cur);
  return out;
}
