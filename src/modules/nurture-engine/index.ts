/**
 * 引导引擎（§3.6）
 *
 * 状态机 + 互动感知 + 智能放弃判定 + 再激活
 *
 * 状态机：
 *   新发现 → 已关注 → 已互动 → 已加好友 → 已加微 → 已预约 → 已成交
 *                                  ↘ 已流失 / 沉默 / 已再激活
 */

import type { Lead, LeadStatus, Task, TaskAction, BusinessProfile, ConversionConfig } from '../../core/types.js';
import { recordStatusChange } from '../feedback-analyzer/event-recorder.js';
import { checkAbandonment, checkOptOut } from './smart-abandon.js';

export interface NurtureEngineOptions {
  profile: BusinessProfile;
  conversion: ConversionConfig;
  /** 每天最多生成多少任务（默认 20） */
  dailyTaskLimit?: number;
  /** 同一客户两次任务间隔（小时，默认 24） */
  minIntervalHours?: number;
  /** 同一客户 0 回应上限（默认 3 → 标记流失） */
  noResponseLimit?: number;
  /** 沉默天数（默认 30） */
  dormantDays?: number;
}

const STATE_ORDER: LeadStatus[] = [
  '新发现', '已关注', '已互动', '已加好友', '已加微', '已预约', '已成交',
];

// ---------------------------------------------------------------------------
// 主入口：生成每日任务
// ---------------------------------------------------------------------------

export function generateDailyTasks(
  leads: Lead[],
  opts: NurtureEngineOptions,
): Task[] {
  const limit = opts.dailyTaskLimit ?? 20;
  const minIntervalMs = (opts.minIntervalHours ?? 24) * 60 * 60 * 1000;
  const noRespLimit = opts.noResponseLimit ?? 3;
  const dormantDays = opts.dormantDays ?? 30;

  const tasks: Task[] = [];
  const now = Date.now();

  // 优先级：按 §3.11 persona value_score 降序 → 高价值 lead 优先
  const sortedLeads = [...leads].sort((a, b) => {
    const va = getPersonaValue(opts.profile, a.persona);
    const vb = getPersonaValue(opts.profile, b.persona);
    return vb - va;
  });

  for (const lead of sortedLeads) {
    if (tasks.length >= limit) break;

    // 1. 检查互动感知（§3.6.2）— 委托给 checkAbandonment（§3.6.3）覆盖 opt_out + 被拒 + 0 回应
    applyInteractionFeedback(lead, noRespLimit, dormantDays);

    // 2. 检查智能放弃（§3.6.3）— 仅做沉默/60 天归档（opt_out + 0 回应已在上面处理）
    applyAbandonmentLogic(lead, dormantDays);

    // 3. 跳过终态
    if (['已成交', '已流失'].includes(lead.status)) continue;

    // 4. 检查任务间隔
    if (lead.last_task_executed_at) {
      const lastExec = new Date(lead.last_task_executed_at).getTime();
      if (now - lastExec < minIntervalMs) continue;
    }

    // 5. 根据状态生成任务
    const task = taskForState(lead, opts);
    if (task) tasks.push(task);
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// §3.6.2 互动效果感知
// ---------------------------------------------------------------------------

function applyInteractionFeedback(lead: Lead, noRespLimit: number, dormantDays: number): void {
  // F11 修复：委托给 checkAbandonment 统一处理 opt_out / 被拒 / 0 回应
  const result = checkAbandonment(lead, noRespLimit, dormantDays);
  if (!result.shouldAbandon || !result.newStatus) return;

  if (result.newStatus === '已流失') {
    // 命中拒绝词（opt_out 信号）→ 同时打 opt_out=true
    if (checkOptOut(lead.last_response_text)) {
      lead.opt_out = true;
    }
    markStatus(lead, '已流失', result.reason);
  } else if (result.newStatus === '沉默') {
    markStatus(lead, '沉默', result.reason);
  }
}

// ---------------------------------------------------------------------------
// §3.6.3 智能放弃判定（仅沉默 + 60 天归档；opt_out / 被拒 / 0 回应已在 §3.6.2 处理）
// ---------------------------------------------------------------------------

function applyAbandonmentLogic(lead: Lead, dormantDays: number): void {
  // 沉默
  const lastInt = lead.last_interaction_at || lead.wechat_added_at || lead.created_at;
  const daysSince = (Date.now() - new Date(lastInt).getTime()) / (1000 * 60 * 60 * 24);
  if (lead.status === '已加微' && daysSince > dormantDays) {
    markStatus(lead, '沉默', `加微 ${Math.round(daysSince)} 天未互动`);
    return;
  }
  // 60 天无任何动作 → 永久归档
  const allDaysSince = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (allDaysSince > 60 && !['已成交', '已流失', '已再激活'].includes(lead.status)) {
    markStatus(lead, '已流失', '60 天无动作');
  }
}

// ---------------------------------------------------------------------------
// §3.6.4 再激活
// ---------------------------------------------------------------------------

export function findReactivatableLeads(leads: Lead[], dormantDays: number = 30): Lead[] {
  const cutoffMs = dormantDays * 24 * 60 * 60 * 1000;
  return leads.filter(l => {
    if (l.status !== '沉默') return false;
    const lastInt = l.last_interaction_at || l.wechat_added_at || l.created_at;
    return Date.now() - new Date(lastInt).getTime() > cutoffMs;
  });
}

export function reactivate(lead: Lead): Task {
  return {
    task_id: crypto.randomUUID(),
    lead_cid: lead.cid,
    nickname: lead.nickname,
    current_state: '沉默',
    next_action: 'dm',
    hook: 'X 总，上次说的方案考虑得怎样？',
    hook_style: '轻量触达',
    priority: 'low',
    persona: lead.persona,
    scheduled_at: new Date().toISOString(),
    reason: '沉默客户再激活',
  };
}

// ---------------------------------------------------------------------------
// 内部：根据状态生成任务
// ---------------------------------------------------------------------------

function taskForState(lead: Lead, opts: NurtureEngineOptions): Task | null {
  const action = nextActionForState(lead.status);
  if (!action) return null;

  // V1.4 简化：钩子已经在 lead.suggested_reply_hook / suggested_dm_hook 里
  // §3.4 RAG 生成在「评论回复」前调用一次
  const hook = action === 'comment_reply' ? lead.suggested_reply_hook
             : action === 'dm' || action === 'send_material' ? lead.suggested_dm_hook
             : '';

  return {
    task_id: crypto.randomUUID(),
    lead_cid: lead.cid,
    nickname: lead.nickname,
    current_state: lead.status,
    next_action: action,
    hook,
    hook_style: 'default',
    priority: 'medium',
    persona: lead.persona,
    scheduled_at: new Date().toISOString(),
    reason: `从 ${lead.status} 推进`,
  };
}

function nextActionForState(status: LeadStatus): TaskAction | null {
  switch (status) {
    case '新发现': return 'like_and_follow';
    case '已关注': return 'comment_reply';
    case '已互动': return 'friend_request';
    case '已加好友': return 'dm';
    case '已私信': return 'send_material';
    case '已加微': return null;  // 交给 §3.10 转化引擎
    case '已预约': return null;  // 等待客户回访
    case '沉默': return 'dm';  // 再激活
    case '已再激活': return 'dm';
    default: return null;
  }
}

function markStatus(lead: Lead, to: LeadStatus, note?: string): void {
  if (lead.status === to) return;
  const from = lead.status;
  lead.status = to;
  lead.status_history.push({ from, to, at: new Date().toISOString(), note });
  lead.updated_at = new Date().toISOString();
  // F3: 接入事件记录器（不阻塞状态机，错误吞掉避免影响主流程）
  const metadata = {
    keyword: lead.keyword ?? '',
    hook_style: lead.hook_style ?? 'default',
    hook_text: lead.suggested_dm_hook ?? lead.suggested_reply_hook ?? '',
    persona: lead.persona,
    interaction_time: lead.last_interaction_at ?? new Date().toISOString(),
  };
  void recordStatusChange(lead.cid, from, to, metadata).catch(() => {});
}

function getPersonaValue(profile: BusinessProfile, personaId: string): number {
  return profile.target_personas.find(p => p.id === personaId)?.value_score ?? 5.0;
}

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

export async function runCLI(args: string[]): Promise<void> {
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const crmPath = get('--crm') || './data/leads.csv';
  const businessDir = get('--business');
  const outputPath = get('--output') || './data/tmp/tasks.json';

  if (!businessDir) {
    console.error('用法: nurture --business <dir> [--crm <path>] [--output <path>]');
    process.exit(1);
  }

  const { loadBusinessProfile } = await import('../../core/business-profile.js');
  const { CsvCRM } = await import('../../adapters/crm/csv.js');
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');

  const { profile, conversion } = await loadBusinessProfile(businessDir);
  const crm = new CsvCRM(crmPath);
  const leads = await crm.listLeads({ has_open_task: true });

  const tasks = generateDailyTasks(leads, { profile, conversion });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(tasks, null, 2), 'utf-8');
  console.log(`[nurture] 生成 ${tasks.length} 任务 → ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
