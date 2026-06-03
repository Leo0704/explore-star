/**
 * 转化引擎（§3.10）
 *
 * V1.4 实现：
 *   - onLeadAddedWechat: 加微后 24h 内推送物料
 *   - watchBookings: 监听预约事件
 *   - generateDailyReport: 转化日报
 *   - findDormantLeads: 找沉默客户
 *   - reactivateLead: 再激活话术生成+推送
 *   - recordTouchpoint: 触达事件记录
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Lead, LeadStatus, ConversionConfig, ConversionReport, BusinessProfile, CRMAdapter } from '../../core/types.js';
import { getNotifier } from '../../adapters/registry.js';
import { pushMaterial, generateConversionReport, pushConversionReport } from './material-pusher.js';
import { watchBookings, syncBookingsOnce } from './booking-listener.js';
import { findDormantLeads } from './dormant-finder.js';
import { reactivateLead as doReactivate, reactivateDormantPool } from './reactivate.js';
import { recordEvent } from '../feedback-analyzer/event-recorder.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'conversion-engine' });

export interface ConversionEngineOptions {
  profile: BusinessProfile;
  conversion: ConversionConfig;
  crm: CRMAdapter;
  eventsRecorder?: (event: any) => Promise<void>;
  postAddDelayHours?: number;
}

// ---------------------------------------------------------------------------
// ConversionEngine 接口实现
// ---------------------------------------------------------------------------

export interface ConversionEngine {
  onLeadAddedWechat(cid: string): Promise<{ pushed: boolean; reason?: string }>;
  watchBookings(): Promise<void>;
  generateDailyReport(date: string): Promise<ConversionReport>;
  findDormantLeads(): Promise<Lead[]>;
  reactivateLead(cid: string): Promise<{ success: boolean; reason: string }>;
  recordTouchpoint(cid: string, _touchpoint: { action_type: string; channel: string; content_summary: string; sent_at: string; persona?: string }): Promise<void>;
}

/**
 * 创建转化引擎实例
 */
export function createConversionEngine(opts: ConversionEngineOptions): ConversionEngine {
  return {
    async onLeadAddedWechat(cid: string): Promise<{ pushed: boolean; reason?: string }> {
      const lead = await opts.crm.getLead(cid);
      if (!lead) return { pushed: false, reason: 'lead 不存在' };
      return pushMaterial(lead, opts);
    },

    async watchBookings(): Promise<void> {
      return watchBookings({ crm: opts.crm });
    },

    async generateDailyReport(date: string): Promise<ConversionReport> {
      const report = await generateConversionReport(date, opts);
      await pushConversionReport(report);
      return report;
    },

    async findDormantLeads(): Promise<Lead[]> {
      return findDormantLeads({ crm: opts.crm, conversion: opts.conversion });
    },

    async reactivateLead(cid: string): Promise<{ success: boolean; reason: string }> {
      const lead = await opts.crm.getLead(cid);
      if (!lead) return { success: false, reason: 'lead 不存在' };
      const result = await doReactivate(lead, opts);
      return { success: result.success, reason: result.reason };
    },

    async recordTouchpoint(cid: string, _touchpoint: { action_type: string; channel: string; content_summary: string; sent_at: string; persona?: string }): Promise<void> {
      await recordEvent({
        event: 'touchpoint_sent',
        cid,
        touchpoint_type: _touchpoint.action_type,
        touchpoint_channel: _touchpoint.channel,
        keyword: _touchpoint.action_type,
        hook_style: _touchpoint.channel,
        hook_text: _touchpoint.content_summary,
        persona: _touchpoint.persona ?? '',
        interaction_time: _touchpoint.sent_at,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 快捷导出（兼容 V1.4 直接调用）
// ---------------------------------------------------------------------------

export { pushMaterial, generateConversionReport, generateConversionReport as generateDailyReport, pushConversionReport, pushConversionReport as pushDailyReport } from './material-pusher.js';
export { watchBookings, syncBookingsOnce } from './booking-listener.js';
export { findDormantLeads } from './dormant-finder.js';
export { reactivateLead as reactivateLead, reactivateDormantPool } from './reactivate.js';

// ---------------------------------------------------------------------------
// 加微后 24h 内推送物料
// ---------------------------------------------------------------------------

export async function handleWechatAdded(
  lead: Lead,
  opts: ConversionEngineOptions,
): Promise<{ pushed: boolean; reason?: string }> {
  const delayMs = (opts.postAddDelayHours ?? 24) * 60 * 60 * 1000;
  const addedAt = lead.wechat_added_at ? new Date(lead.wechat_added_at).getTime() : 0;
  const elapsed = Date.now() - addedAt;

  if (elapsed < delayMs) {
    return { pushed: false, reason: `未到 ${delayMs / 3600000}h 延迟（已 ${(elapsed / 3600000).toFixed(1)}h）` };
  }
  if (lead.status !== '已加微') {
    return { pushed: false, reason: `状态已变更为 ${lead.status}` };
  }
  if (!opts.conversion.post_add_asset) {
    return { pushed: false, reason: '业务方未配置 post_add_asset' };
  }

  // 推送给客户（wechat adapter 未实现时 fallback console）
  let notifier;
  try { notifier = getNotifier('wechat'); } catch { notifier = getNotifier('console'); }
  await notifier.send({
    title: `给 ${lead.nickname} 推送物料`,
    body: opts.conversion.message_template
      ?.replace(/\{\{nickname\}\}/g, lead.nickname)
      ?.replace(/\{\{booking_url\}\}/g, opts.conversion.booking_url ?? '') ?? '',
    level: 'info',
  });

  // 注意：物料推送 ≠ 客户预约。状态推进留给 booking-listener / 实际客户行为。
  // 触达事件由下方 recordEvent('touchpoint_sent') 落盘，无需再改 lead.status。

  // Loop 5: 记录触达事件（供反馈分析器归因）
  void recordEvent({
    event: 'touchpoint_sent',
    cid: lead.cid,
    keyword: 'send_material',
    hook_style: 'wechat',
    hook_text: opts.conversion.post_add_asset!.name,
    persona: lead.persona,
    interaction_time: new Date().toISOString(),
    touchpoint_type: 'send_material',
    touchpoint_channel: 'wechat',
  }).catch(() => {});

  return { pushed: true };
}

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

export async function runCLI(args: string[]): Promise<void> {
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const businessDir = get('--business');
  const crmPath = get('--crm') || './data/leads.csv';
  if (!businessDir) {
    console.error('用法: convert --business <dir> [--crm <path>]');
    process.exit(1);
  }

  const { loadBusinessProfile } = await import('../../core/business-profile.js');
  const { CsvCRM } = await import('../../adapters/crm/csv.js');

  const { profile, conversion } = await loadBusinessProfile(businessDir);
  const crm = new CsvCRM(crmPath);
  const { generateConversionReport, pushConversionReport } = await import('./material-pusher.js');
  const report = await generateConversionReport(new Date().toISOString().slice(0, 10), { profile, conversion, crm });
  await pushConversionReport(report);

  const reportPath = `./data/feedback/daily-${report.date}.json`;
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  log.info({ reportPath }, '转化日报已生成');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
