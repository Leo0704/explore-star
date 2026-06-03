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
