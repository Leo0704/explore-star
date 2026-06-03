import type { Lead, CRMAdapter, ConversionConfig } from '../../core/types.js';
import { getNotifier } from '../../adapters/registry.js';
import { findDormantLeads } from './dormant-finder.js';

export interface ReactivateOptions {
  crm: CRMAdapter;
  conversion: ConversionConfig;
}

interface ReactivateResult {
  cid: string;
  nickname: string;
  success: boolean;
  reason: string;
}

export async function reactivateLead(
  lead: Lead,
  opts: ReactivateOptions,
): Promise<ReactivateResult> {
  const messageTemplate = opts.conversion.reactivation?.message_template
    ?? `{{nickname}} 您好，上次给您发的资料看了吗？如果最近又有新的想法，欢迎随时交流。`;

  const message = messageTemplate
    .replace(/\{\{nickname\}\}/g, lead.nickname);

  const notifier = getNotifier('console');
  await notifier.send({
    title: `再激活：${lead.nickname}`,
    body: message,
    level: 'warning',
  });

  await opts.crm.updateStatus(lead.cid, '已再激活', '再激活触达');

  return {
    cid: lead.cid,
    nickname: lead.nickname,
    success: true,
    reason: '已发送再激活消息',
  };
}

export async function reactivateDormantPool(
  opts: ReactivateOptions,
): Promise<ReactivateResult[]> {
  const dormant = await findDormantLeads(opts);
  const results: ReactivateResult[] = [];

  for (const lead of dormant) {
    try {
      const result = await reactivateLead(lead, opts);
      results.push(result);
    } catch (e) {
      results.push({
        cid: lead.cid,
        nickname: lead.nickname,
        success: false,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}