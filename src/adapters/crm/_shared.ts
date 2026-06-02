/**
 * CRM adapter 共享逻辑（§3.5）
 */

import type { Lead } from '../../core/types.js';

export const LEAD_FIELDS: ReadonlyArray<keyof Lead> = [
  'cid', 'source', 'aweme_id', 'video_url', 'video_desc', 'keyword',
  'nickname', 'user_signature', 'follower_count', 'user_uid',
  'comment_text', 'comment_digg_count', 'comment_create_time',
  'is_target_persona', 'persona', 'pain_point', 'intent_score', 'buying_stage',
  'suggested_reply_hook', 'suggested_dm_hook',
  'status', 'last_task_executed_at', 'last_task_result', 'last_response_text',
  'execution_count', 'response_count',
  'wechat_added_at', 'booked_at', 'closed_at', 'revenue', 'last_interaction_at',
  'created_at', 'updated_at', 'notes',
] as const;

const EMPTY: ReadonlySet<unknown> = new Set([undefined, null, '']);

export function leadToFlatObject(lead: Lead): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const f of LEAD_FIELDS) {
    const v = lead[f];
    if (EMPTY.has(v)) continue;
    out[f as string] = v as string | number | boolean;
  }
  return out;
}

export function flatObjectToLead(obj: Record<string, unknown>): Lead {
  const result: Record<string, unknown> = {};
  for (const f of LEAD_FIELDS) {
    const v = obj[f as string];
    if (v !== undefined) result[f as string] = v;
  }
  return result as unknown as Lead;
}

/** CWE-1236: 首字符 = / + / - / @ / TAB / CR 时前置单引号 */
export function escapeFormula(s: string): string {
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

export async function runSync(
  leads: Lead[],
  upsertLead: (lead: Lead) => Promise<void>,
): Promise<{ synced: number; failed: number; errors: Array<{ cid: string; error: string }> }> {
  const errors: Array<{ cid: string; error: string }> = [];
  let synced = 0;
  for (const lead of leads) {
    try {
      await upsertLead(lead);
      synced++;
    } catch (e) {
      errors.push({ cid: lead.cid, error: String(e) });
    }
  }
  return { synced, failed: errors.length, errors };
}

/** stdField → crmField（缺省回落原名） */
export function fieldMap(mapping: Record<string, string>, stdField: string): string {
  return mapping?.[stdField] ?? stdField;
}
