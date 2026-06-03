/**
 * 物料推送器（§3.10 加微后 24h 内推送 + 转化日报 + ROI）
 *
 * V1.4 实现：
 *   - 加微后 24h 内推送 post_add_asset（PDF / link / image）
 *   - 转化日报生成（每天 22:00）
 *   - ROI 计算
 */

import type { Lead, ConversionConfig, ConversionReport, BusinessProfile, CRMAdapter } from '../../core/types.js';
import { getNotifier } from '../../adapters/registry.js';
import { recordEvent } from '../feedback-analyzer/event-recorder.js';

export interface MaterialPusherOptions {
  profile: BusinessProfile;
  conversion: ConversionConfig;
  crm: CRMAdapter;
  /** 加微后延迟推送时长（小时，默认 24） */
  postAddDelayHours?: number;
}

// ---------------------------------------------------------------------------
// 加微后 24h 内推送物料
// ---------------------------------------------------------------------------

export async function pushMaterial(
  lead: Lead,
  opts: MaterialPusherOptions,
): Promise<{ pushed: boolean; reason?: string }> {
  const delayMs = (opts.postAddDelayHours ?? 24) * 60 * 60 * 1000;
  const addedAt = lead.wechat_added_at ? new Date(lead.wechat_added_at).getTime() : 0;
  const elapsed = addedAt > 0 ? Date.now() - addedAt : 0;

  if (addedAt === 0) {
    return { pushed: false, reason: 'lead 无 wechat_added_at 记录' };
  }
  if (elapsed < delayMs) {
    return { pushed: false, reason: `未到 ${delayMs / 3600000}h 延迟（已 ${(elapsed / 3600000).toFixed(1)}h）` };
  }
  if (!['已加微', '已加好友', '已私信'].includes(lead.status)) {
    return { pushed: false, reason: `状态已变更为 ${lead.status}，不再推送物料` };
  }
  if (!opts.conversion.post_add_asset) {
    return { pushed: false, reason: '业务方未配置 post_add_asset' };
  }

  // 推送物料
  // P0-B 修复：V1.4 真实 PDF 推送通道未实现，对 PDF 类型 fail-loud。
  // link / image 类型走 text notifier（仅发文字描述）。
  const asset = opts.conversion.post_add_asset;
  if (asset?.type === 'pdf') {
    throw new Error(
      `V1.4 不支持 PDF 推送（业务方配了 post_add_asset.type="pdf"，name="${asset.name}"）。` +
      `请改用 type: "link" + 消息里附 URL，或接入 MaterialDeliveryAdapter（v2 路线）。`,
    );
  }
  const notifierName = opts.profile.notifier?.default ?? 'console';
  const notifier = getNotifier(notifierName);
  const message = buildMessage(lead, opts.conversion);

  await notifier.send({
    title: `给 ${lead.nickname} 推送物料`,
    body: message,
    level: 'info',
  });

  // 记录触达事件（F12：用于 §3.10 触达方式归因回路）
  // P0-B 修复：touchpoint_channel 用实际 notifier 名（不再是 'console'）
  const action_type = `send_${asset?.type ?? 'asset'}`;
  await recordEvent({
    event: 'touchpoint_sent',
    cid: lead.cid,
    touchpoint_type: action_type,
    touchpoint_channel: notifierName,
    keyword: action_type,
    hook_style: notifierName,
    hook_text: `推送物料「${asset?.name ?? ''}」`,
    persona: '',
    interaction_time: new Date().toISOString(),
  });

  // 注意：物料推送 ≠ 客户预约。状态推进留给 booking-listener / 实际客户行为。
  // 触达事件已通过 recordEvent('touchpoint_sent') 落盘，无需再改 lead.status。

  return { pushed: true };
}

function buildMessage(lead: Lead, conversion: ConversionConfig): string {
  const asset = conversion.post_add_asset;
  const msg = conversion.message_template
    ?.replace(/\{\{nickname\}\}/g, lead.nickname)
    ?.replace(/\{\{booking_url\}\}/g, conversion.booking_url ?? '') ?? '';

  let out = `${msg}\n\n`;
  out += `📎 物料：「${asset?.name}」`;
  if (asset?.type === 'pdf') out += `（PDF 文件）`;
  else if (asset?.type === 'link') out += `：${asset.path}`;
  else if (asset?.type === 'image') out += `（图片）`;

  return out;
}

// ---------------------------------------------------------------------------
// 转化日报生成
// ---------------------------------------------------------------------------

export async function generateConversionReport(
  date: string,
  opts: MaterialPusherOptions,
): Promise<ConversionReport> {
  const all = await opts.crm.listLeads();

  const todayStart = new Date(date + 'T00:00:00').getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;

  const inRange = (iso: string | undefined, start: number, end: number): boolean => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= start && t < end;
  };

  const newLeads = all.filter((l: Lead) => inRange(l.created_at, todayStart, todayEnd));
  const newWechat = all.filter((l: Lead) => inRange(l.wechat_added_at, todayStart, todayEnd));
  const newBookings = all.filter((l: Lead) => inRange(l.booked_at, todayStart, todayEnd));
  const newClosed = all.filter((l: Lead) => inRange(l.closed_at, todayStart, todayEnd));

  const revenueToday = newClosed.reduce((s: number, l: Lead) => s + (l.revenue ?? 0), 0);
  const weeklyRevenue = all.filter((l: Lead) => inRange(l.closed_at, weekStart, todayEnd))
    .reduce((s: number, l: Lead) => s + (l.revenue ?? 0), 0);

  const costToday = newLeads.length * (opts.conversion.cost_per_lead ?? 5);

  // Hot leads：即将成交
  const hot = all.filter((l: Lead) => ['已加微', '已预约', '已诊断'].includes(l.status))
    .sort((a: Lead, b: Lead) => b.intent_score - a.intent_score).slice(0, 5);

  // At risk：加微 > 5 天未互动
  const atRisk = all.filter((l: Lead) => {
    if (!['已加微', '已私信'].includes(l.status) || !l.wechat_added_at) return false;
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
    cost_today: costToday,
    roi_today: costToday > 0 ? revenueToday / costToday : 0,
    hot_leads: hot,
    at_risk_leads: atRisk,
  };
}

// ---------------------------------------------------------------------------
// 推送转化日报
// ---------------------------------------------------------------------------

export async function pushConversionReport(report: ConversionReport): Promise<void> {
  const notifier = getNotifier('console');
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