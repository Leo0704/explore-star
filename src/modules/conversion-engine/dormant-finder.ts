import type { Lead, CRMAdapter, ConversionConfig } from '../../core/types.js';

export interface DormantFinderOptions {
  crm: CRMAdapter;
  conversion: ConversionConfig;
}

export async function findDormantLeads(
  opts: DormantFinderOptions,
): Promise<Lead[]> {
  const dormantDays = opts.conversion.reactivation?.dormant_days ?? 30;
  const cutoff = Date.now() - dormantDays * 24 * 60 * 60 * 1000;

  const all = await opts.crm.listLeads();
  const dormant: Lead[] = [];

  for (const lead of all) {
    if (!['已加微', '已私信'].includes(lead.status)) continue;

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
