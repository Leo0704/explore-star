/**
 * 沉默客户发现器（§3.10 再激活：30 天沉默池）
 *
 * V1.4 实现：从 CRM 找"已加微但 30 天无互动"的 lead
 */

import type { Lead, CRMAdapter, ConversionConfig } from '../../core/types.js';

export interface DormantFinderOptions {
  crm: CRMAdapter;
  conversion: ConversionConfig;
}

/**
 * 找沉默 lead（加微后 dormant_days 天无互动，未成交）
 */
export async function findDormantLeads(
  opts: DormantFinderOptions,
): Promise<Lead[]> {
  const dormantDays = opts.conversion.reactivation?.dormant_days ?? 30;
  const cutoff = Date.now() - dormantDays * 24 * 60 * 60 * 1000;

  const all = await opts.crm.listLeads();
  const dormant: Lead[] = [];

  for (const lead of all) {
    if (!['已加微', '已私信'].includes(lead.status)) continue;
    if (lead.status === '已成交' || lead.status === '已流失' || lead.status === '已再激活') continue;

    // 最后互动时间
    const lastInteraction = lead.last_interaction_at
      ? new Date(lead.last_interaction_at).getTime()
      : lead.wechat_added_at
        ? new Date(lead.wechat_added_at).getTime()
        : 0;

    if (lastInteraction > 0 && lastInteraction < cutoff) {
      dormant.push(lead);
    }
  }

  return dormant;
}

/**
 * 统计沉默客户汇总
 */
export async function dormantSummary(
  opts: DormantFinderOptions,
): Promise<{ count: number; oldestDays: number; byPersona: Record<string, number> }> {
  const dormant = await findDormantLeads(opts);
  const now = Date.now();

  let oldestDays = 0;
  const byPersona: Record<string, number> = {};

  for (const lead of dormant) {
    const last = lead.last_interaction_at
      ? new Date(lead.last_interaction_at).getTime()
      : lead.wechat_added_at ? new Date(lead.wechat_added_at).getTime() : now;
    const days = Math.floor((now - last) / (1000 * 60 * 60 * 24));
    if (days > oldestDays) oldestDays = days;
    byPersona[lead.persona] = (byPersona[lead.persona] ?? 0) + 1;
  }

  return { count: dormant.length, oldestDays, byPersona };
}