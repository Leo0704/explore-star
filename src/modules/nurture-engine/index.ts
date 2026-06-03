import type { Lead, LeadStatus, Task, TaskAction, BusinessProfile, ConversionConfig, WeeklyInsights } from '../../core/types.js';
import { recordStatusChange } from '../feedback-analyzer/event-recorder.js';
import { checkAbandonment, checkOptOut } from './smart-abandon.js';
import { buildTask } from './state-machine.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'nurture-engine' });

export interface NurtureEngineOptions {
  profile: BusinessProfile;
  conversion: ConversionConfig;
  dailyTaskLimit?: number;
  minIntervalHours?: number;
  noResponseLimit?: number;
  dormantDays?: number;
  insights?: WeeklyInsights | null;
}


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

  const personaValueMap = new Map<string, number>();
  if (opts.insights?.persona_value) {
    for (const pv of opts.insights.persona_value) {
      personaValueMap.set(pv.persona, pv.value_score);
    }
  }
  const sortedLeads = [...leads].sort((a, b) => {
    const va = personaValueMap.get(a.persona) ?? getPersonaValue(opts.profile, a.persona);
    const vb = personaValueMap.get(b.persona) ?? getPersonaValue(opts.profile, b.persona);
    return vb - va;
  });

  for (const lead of sortedLeads) {
    if (tasks.length >= limit) break;

    applyInteractionFeedback(lead, noRespLimit, dormantDays);

    if (['已成交', '已流失'].includes(lead.status)) continue;

    if (lead.last_task_executed_at) {
      const lastExec = new Date(lead.last_task_executed_at).getTime();
      if (now - lastExec < minIntervalMs) continue;
    }

    const task = buildTask(lead, opts.profile);
    if (task) {
      task.scheduled_at = pickBestTime(opts.insights, lead.persona);
      tasks.push(task);
    }
  }

  return tasks;
}

function applyInteractionFeedback(lead: Lead, noRespLimit: number, dormantDays: number): void {
  const result = checkAbandonment(lead, noRespLimit, dormantDays);
  if (!result.shouldAbandon || !result.newStatus) return;

  if (result.newStatus === '已流失') {
    if (checkOptOut(lead.last_response_text)) {
      lead.opt_out = true;
    }
    markStatus(lead, '已流失', result.reason);
  } else if (result.newStatus === '沉默') {
    markStatus(lead, '沉默', result.reason);
  }
}


export function findReactivatableLeads(leads: Lead[], dormantDays: number = 30): Lead[] {
  const cutoffMs = dormantDays * 24 * 60 * 60 * 1000;
  return leads.filter(l => {
    if (l.status !== '沉默') return false;
    const lastInt = l.last_interaction_at || l.wechat_added_at || l.created_at;
    return Date.now() - new Date(lastInt).getTime() > cutoffMs;
  });
}

export function reactivate(lead: Lead): Task {
  const hook = lead.suggested_dm_hook?.replace(/\{\{nickname\}\}/g, lead.nickname)
    ?? `${lead.nickname}，上次聊的方案考虑得怎样？`;
  return {
    task_id: crypto.randomUUID(),
    lead_cid: lead.cid,
    nickname: lead.nickname,
    current_state: '沉默',
    next_action: 'dm',
    hook,
    hook_style: '轻量触达',
    priority: 'low',
    persona: lead.persona,
    scheduled_at: new Date().toISOString(),
    reason: '沉默客户再激活',
  };
}

function markStatus(lead: Lead, to: LeadStatus, note?: string, overrides?: { hook_text?: string; revenue?: number }): void {
  if (lead.status === to) return;
  const from = lead.status;
  lead.status = to;
  lead.status_history.push({ from, to, at: new Date().toISOString(), note });
  lead.updated_at = new Date().toISOString();
  const metadata: Parameters<typeof recordStatusChange>[3] = {
    keyword: lead.keyword ?? '',
    hook_style: lead.hook_style ?? 'default',
    hook_text: overrides?.hook_text ?? lead.suggested_dm_hook ?? lead.suggested_reply_hook ?? '',
    persona: lead.persona,
    interaction_time: lead.last_interaction_at ?? new Date().toISOString(),
  };
  if (to === '已成交' && (overrides?.revenue ?? lead.revenue)) {
    metadata.metadata = { revenue: overrides?.revenue ?? lead.revenue };
  }
  void recordStatusChange(lead.cid, from, to, metadata).catch(() => {});
}

function getPersonaValue(profile: BusinessProfile, personaId: string): number {
  return profile.target_personas.find(p => p.id === personaId)?.value_score ?? 5.0;
}

function pickBestTime(insights: WeeklyInsights | null | undefined, personaId: string): string {
  const bestTimes = insights?.best_interaction_times;
  if (!bestTimes || bestTimes.length === 0) {
    return nextDefaultTime();
  }
  const personaTime = bestTimes.find(t => t.persona === personaId);
  if (!personaTime || personaTime.hours.length === 0) {
    return nextDefaultTime();
  }
  const topHours = [...personaTime.hours]
    .sort((a, b) => b.sample - a.sample)
    .slice(0, 3);
  const picked = topHours[Math.floor(Math.random() * topHours.length)];
  const now = new Date();
  for (let d = 0; d < 7; d++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + d);
    if (candidate.getDay() !== picked.weekday) continue;
    candidate.setHours(picked.hour, Math.floor(Math.random() * 30), 0, 0);
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
  return nextDefaultTime();
}

function nextDefaultTime(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(9, 30, 0, 0);
  return t.toISOString();
}

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
  log.info({ count: tasks.length, outputPath }, '生成任务');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
