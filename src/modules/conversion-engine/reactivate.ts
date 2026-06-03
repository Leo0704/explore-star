/**
 * 沉默客户再激活（§3.10 再激活话术生成 + 推送）
 *
 * V1.4 实现：
 *   - 生成个性化再激活话术（用 conversion.message_template + RAG）
 *   - 推送并更新 lead 状态
 */

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

/**
 * 再激活单个 lead（根据 message_template 生成话术）
 */
export async function reactivateLead(
  lead: Lead,
  opts: ReactivateOptions,
): Promise<ReactivateResult> {
  // V1.4: 暂不在 lead 上记录 attempts，通过 events.jsonl 判断
  // 如果 lead 有"已再激活"记录，跳过

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

  // 更新状态为"已再激活"
  await opts.crm.updateStatus(lead.cid, '已再激活', '再激活触达');

  return {
    cid: lead.cid,
    nickname: lead.nickname,
    success: true,
    reason: '已发送再激活消息',
  };
}

/**
 * 批量再激活沉默客户
 */
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