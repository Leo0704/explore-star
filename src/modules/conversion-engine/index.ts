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

export { pushMaterial, generateConversionReport, pushConversionReport } from './material-pusher.js';
export { watchBookings, syncBookingsOnce } from './booking-listener.js';
export { findDormantLeads, dormantSummary } from './dormant-finder.js';
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

  // 推送给客户
  const notifier = getNotifier('wechat');  // V1.4 暂未实现 wechat，会用 console
  await notifier.send({
    title: `给 ${lead.nickname} 推送物料`,
    body: opts.conversion.message_template
      ?.replace(/\{\{nickname\}\}/g, lead.nickname)
      ?.replace(/\{\{booking_url\}\}/g, opts.conversion.booking_url ?? '') ?? '',
    level: 'info',
  });

  // 更新 lead 状态
  await opts.crm.updateStatus(lead.cid, '已预约', '已推送加微后物料');

  return { pushed: true };
}

// ---------------------------------------------------------------------------
// 转化日报
// ---------------------------------------------------------------------------

export async function generateDailyReport(
  date: string,
  opts: ConversionEngineOptions,
): Promise<ConversionReport> {
  const all = await opts.crm.listLeads();

  const todayStart = new Date(date + 'T00:00:00').getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
  const monthStart = new Date(new Date(date).getFullYear(), new Date(date).getMonth(), 1).getTime();

  const newLeads: Lead[] = all.filter((l: Lead) => {
    const t = new Date(l.created_at).getTime();
    return t >= todayStart && t < todayEnd;
  });

  const newWechat: Lead[] = all.filter((l: Lead) => l.wechat_added_at ? inRange(l.wechat_added_at, todayStart, todayEnd) : false);
  const newBookings: Lead[] = all.filter((l: Lead) => l.booked_at ? inRange(l.booked_at, todayStart, todayEnd) : false);
  const newClosed: Lead[] = all.filter((l: Lead) => l.closed_at ? inRange(l.closed_at, todayStart, todayEnd) : false);

  const revenueToday = newClosed.reduce((s: number, l: Lead) => s + (l.revenue ?? 0), 0);
  const weeklyRevenue = all.filter((l: Lead) => l.closed_at && new Date(l.closed_at).getTime() >= weekStart)
    .reduce((s: number, l: Lead) => s + (l.revenue ?? 0), 0);

  // 估算今日成本（V1.4 简化：lead 数 × cost_per_lead）
  const cost = newLeads.length * (opts.conversion.cost_per_lead ?? 5);

  // Hot leads：状态 = 已加微 / 已预约 / 已诊断（即将成交）
  const hot: Lead[] = all.filter((l: Lead) => ['已加微', '已预约', '已诊断'].includes(l.status))
    .sort((a: Lead, b: Lead) => b.intent_score - a.intent_score).slice(0, 5);

  // At risk：加微 > 5 天未互动
  const atRisk: Lead[] = all.filter((l: Lead) => {
    if (l.status !== '已加微' || !l.wechat_added_at) return false;
    const days = (Date.now() - new Date(l.wechat_added_at).getTime()) / (1000 * 60 * 60 * 24);
    return days > 5;
  }).slice(0, 5);

  return {
    date,
    new_leads: newLeads.length,
    new_wechat_added: newWechat.length,
    new_bookings: newBookings.length,
    new_deals_closed: newClosed.length,
    revenue_today: revenueToday,
    weekly_revenue: weeklyRevenue,
    cost_today: cost,
    roi_today: cost > 0 ? revenueToday / cost : 0,
    hot_leads: hot,
    at_risk_leads: atRisk,
  };
}

function inRange(iso: string, start: number, end: number): boolean {
  const t = new Date(iso).getTime();
  return t >= start && t < end;
}

// ---------------------------------------------------------------------------
// 推送转化日报
// ---------------------------------------------------------------------------

export async function pushDailyReport(report: ConversionReport, notifierName: string = 'console'): Promise<void> {
  const notifier = getNotifier(notifierName);
  const body = `📈 探星转化日报 ${report.date}

[今日漏斗]
新发现：${report.new_leads} → 加微：${report.new_wechat_added} → 预约：${report.new_bookings} → 成交：${report.new_deals_closed}

[营收]
今日：¥${report.revenue_today.toLocaleString()}
本周：¥${report.weekly_revenue.toLocaleString()}

[ROI]
成本：¥${report.cost_today} | 营收：¥${report.revenue_today} | ROI：${report.roi_today.toFixed(1)}x

[Hot Leads] 即将成交
${report.hot_leads.map(l => `- @${l.nickname}（${l.status}，意向 ${l.intent_score}）`).join('\n') || '（无）'}

[At Risk] 可能流失
${report.at_risk_leads.map(l => `- @${l.nickname}（${l.status}，加微 ${Math.round((Date.now() - new Date(l.wechat_added_at!).getTime()) / 86400000)} 天）`).join('\n') || '（无）'}
`;
  await notifier.send({ title: `📈 探星转化日报 ${report.date}`, body, level: 'info' });
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
  const report = await generateDailyReport(new Date().toISOString().slice(0, 10), { profile, conversion, crm });
  await pushDailyReport(report);

  const reportPath = `./data/feedback/daily-${report.date}.json`;
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[convert] 转化日报已生成 → ${reportPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
