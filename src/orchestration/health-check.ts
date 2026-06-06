import { existsSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { getNotifier, getCRM, getChannel, listLLMs } from '../adapters/registry.js';
import { loadBusinessProfile } from '../core/business-profile.js';

export type HealthStatus = 'ok' | 'warning' | 'critical' | 'error';

export interface HealthCheckResult {
  status: HealthStatus;
  checks: Array<{
    name: string;
    status: HealthStatus;
    message: string;
    details?: Record<string, unknown>;
  }>;
  summary: string;
}

export async function checkAll(businessDir?: string): Promise<HealthCheckResult> {
  const results = [
    await checkSystemHealth(),
    await checkAdapterHealth(businessDir),
    await checkSafetyLimits(businessDir),
    await checkEmergencyStop(),
  ];

  const allChecks = results.flatMap(r => r.checks);
  const criticalCount = allChecks.filter(c => c.status === 'critical').length;
  const errorCount = allChecks.filter(c => c.status === 'error').length;
  const warningCount = allChecks.filter(c => c.status === 'warning').length;

  let overall: HealthStatus = 'ok';
  if (criticalCount > 0 || errorCount > 0) overall = 'critical';
  else if (warningCount > 0) overall = 'warning';

  return {
    status: overall,
    checks: allChecks,
    summary: `${criticalCount} 严重 / ${warningCount} 警告 / ${allChecks.length - criticalCount - warningCount - errorCount} 正常`,
  };
}

export async function checkSystemHealth(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = [];

  try {
    const dataPath = './data';
    if (existsSync(dataPath)) {
      statSync(dataPath);
      let realFreeGb = 0;
      if (typeof statfsSync === 'function') {
        const stats = statfsSync(dataPath);
        realFreeGb = (stats.bsize * stats.bfree) / 1024 / 1024 / 1024;
      }
      checks.push({
        name: 'disk_space',
        status: realFreeGb > 1 ? 'ok' : realFreeGb === 0 ? 'warning' : 'critical',
        message: realFreeGb > 0
          ? `磁盘空间充足（${realFreeGb.toFixed(2)} GB 可用）`
          : '无法读取磁盘剩余空间（statfs 不可用）',
        details: { realFreeGb },
      });
    }
  } catch {
    checks.push({ name: 'disk_space', status: 'warning', message: '无法检查磁盘空间' });
  }

  const logPath = './logs';
  if (existsSync(logPath)) {
    checks.push({ name: 'log_dir', status: 'ok', message: '日志目录存在' });
  } else {
    checks.push({ name: 'log_dir', status: 'warning', message: '日志目录不存在，将自动创建' });
  }

  const todayLog = join('./logs', `${new Date().toISOString().slice(0, 10)}.log`);
  if (existsSync(todayLog)) {
    checks.push({ name: 'today_log', status: 'ok', message: '今日日志文件存在' });
  } else {
    checks.push({ name: 'today_log', status: 'warning', message: '今日尚未运行' });
  }

  // cron 状态：检查最近一次 run 是否在 48h 内
  const runHistoryPath = './data/run_history.jsonl';
  if (existsSync(runHistoryPath)) {
    try {
      const lines = readFileSync(runHistoryPath, 'utf-8').trim().split('\n').filter(Boolean);
      if (lines.length === 0) {
        checks.push({ name: 'cron_status', status: 'warning', message: '运行历史为空，从未执行过' });
      } else {
        const last = JSON.parse(lines[lines.length - 1]);
        const finishedAt = new Date(last.finished_at).getTime();
        const hoursSince = (Date.now() - finishedAt) / (1000 * 60 * 60);
        if (hoursSince < 24) {
          checks.push({
            name: 'cron_status',
            status: 'ok',
            message: `最近运行 ${hoursSince.toFixed(1)}h 前`,
            details: { last_run: last.finished_at, hours_since: Math.round(hoursSince) },
          });
        } else if (hoursSince < 48) {
          checks.push({
            name: 'cron_status',
            status: 'warning',
            message: `最近运行 ${hoursSince.toFixed(1)}h 前，可能未按时调度`,
            details: { last_run: last.finished_at, hours_since: Math.round(hoursSince) },
          });
        } else {
          checks.push({
            name: 'cron_status',
            status: 'critical',
            message: `最近运行 ${hoursSince.toFixed(1)}h 前，调度可能已中断`,
            details: { last_run: last.finished_at, hours_since: Math.round(hoursSince) },
          });
        }
      }
    } catch {
      checks.push({ name: 'cron_status', status: 'warning', message: '运行历史文件解析失败' });
    }
  } else {
    checks.push({ name: 'cron_status', status: 'warning', message: '运行历史文件不存在，从未执行过' });
  }

  const hasCritical = checks.some(c => c.status === 'critical');
  return {
    status: hasCritical ? 'critical' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok',
    checks,
    summary: `系统检查：${checks.filter(c => c.status === 'ok').length}/${checks.length} 通过`,
  };
}

export async function checkAdapterHealth(businessDir?: string): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = [];

  try {
    const llms = listLLMs();
    if (llms.length > 0) {
      checks.push({ name: 'llm', status: 'ok', message: `LLM 可用：${llms.join(', ')}` });
    } else {
      checks.push({ name: 'llm', status: 'warning', message: 'LLM 未注册（API Key 可能缺失）' });
    }
  } catch (e) {
    checks.push({ name: 'llm', status: 'error', message: `LLM 检查失败：${e instanceof Error ? e.message : String(e)}` });
  }

  let crmType = 'csv';
  if (businessDir) {
    try {
      const { profile } = await loadBusinessProfile(businessDir);
      crmType = profile.crm.type;
    } catch { }
  }
  try {
    const crm = getCRM(crmType);
    if (crm) {
      const ok = await crm.ping();
      checks.push({ name: 'crm', status: ok ? 'ok' : 'warning', message: ok ? `CRM (${crmType}) 连通正常` : `CRM (${crmType}) ping 失败` });
    } else {
      checks.push({ name: 'crm', status: 'warning', message: `CRM (${crmType}) 未配置` });
    }
  } catch (e) {
    checks.push({ name: 'crm', status: 'error', message: `CRM (${crmType}) 检查失败：${e instanceof Error ? e.message : String(e)}` });
  }

  try {
    const channel = getChannel('douyin');
    if (channel) {
      const result = await channel.ping();
      checks.push({
        name: 'channel',
        status: result.ok ? 'ok' : 'warning',
        message: result.loggedIn ? '抖音 Channel 已登录' : '抖音 Channel 未登录',
      });
    } else {
      checks.push({ name: 'channel', status: 'warning', message: '抖音 Channel 未配置' });
    }
  } catch (e) {
    checks.push({ name: 'channel', status: 'error', message: `Channel 检查失败：${e instanceof Error ? e.message : String(e)}` });
  }

  try {
    const notifier = getNotifier('console');
    checks.push({ name: 'notifier', status: 'ok', message: 'Notifier 可用' });
  } catch (e) {
    checks.push({ name: 'notifier', status: 'error', message: `Notifier 失败：${e instanceof Error ? e.message : String(e)}` });
  }

  const hasCritical = checks.some(c => c.status === 'critical');
  return {
    status: hasCritical ? 'critical' : checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok',
    checks,
    summary: `Adapter 检查：${checks.filter(c => c.status === 'ok').length}/${checks.length} 通过`,
  };
}

export async function checkSafetyLimits(businessDir?: string): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = [];
  const today = new Date().toISOString().slice(0, 10);
  const safetyPath = './config/safety.json';

  let safetyConfig: Record<string, unknown> = {};
  try {
    if (existsSync(safetyPath)) {
      safetyConfig = JSON.parse(readFileSync(safetyPath, 'utf-8'));
    }
  } catch {
  }

  const budget = safetyConfig.daily_budget as Record<string, number> || {};
  const limits = safetyConfig.rate_limits as Record<string, unknown> || {};

  const tasksPath = `./data/tmp/tasks-${today}.json`;
  let todayTasks = 0;
  if (existsSync(tasksPath)) {
    try {
      const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
      todayTasks = Array.isArray(tasks) ? tasks.length : 0;
    } catch {
    }
  }

  const maxTasks = (budget.engagement_actions as number) || 20;
  checks.push({
    name: 'daily_tasks',
    status: todayTasks < maxTasks ? 'ok' : 'critical',
    message: `今日任务 ${todayTasks}/${maxTasks}`,
    details: { used: todayTasks, limit: maxTasks },
  });

  const douyinLimits = (limits?.douyin as Record<string, number>) || {};
  const countersPath = `./data/rate-counters-${today}.json`;
  let counters = { friend_requests_today: 0, dm_today: 0 };
  if (existsSync(countersPath)) {
    try {
      counters = JSON.parse(readFileSync(countersPath, 'utf-8'));
    } catch { }
  }

  const maxFriendReq = douyinLimits.friend_request_per_day ?? 20;
  checks.push({
    name: 'friend_requests',
    status: counters.friend_requests_today < maxFriendReq ? 'ok' : 'critical',
    message: `今日好友申请 ${counters.friend_requests_today}/${maxFriendReq}`,
    details: { used: counters.friend_requests_today, limit: maxFriendReq },
  });

  const maxDm = douyinLimits.dm_per_day ?? 50;
  checks.push({
    name: 'dm_quota',
    status: counters.dm_today < maxDm ? 'ok' : 'critical',
    message: `今日私信 ${counters.dm_today}/${maxDm}`,
    details: { used: counters.dm_today, limit: maxDm },
  });

  const hasCritical = checks.some(c => c.status === 'critical');
  return {
    status: hasCritical ? 'critical' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok',
    checks,
    summary: `限速检查：${todayTasks}/${maxTasks} 任务，${counters.friend_requests_today}/${maxFriendReq} 好友，${counters.dm_today}/${maxDm} 私信`,
  };
}

export async function checkEmergencyStop(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = [];
  const stopPath = './config/EMERGENCY_STOP';

  if (existsSync(stopPath)) {
    checks.push({
      name: 'emergency_stop',
      status: 'critical',
      message: '紧急停止开关已启用！系统不会执行任何任务',
      details: { path: stopPath },
    });
  } else {
    checks.push({ name: 'emergency_stop', status: 'ok', message: '紧急停止开关未启用' });
  }

  return {
    status: checks[0].status,
    checks,
    summary: checks[0].message,
  };
}

export function formatHealthReport(result: HealthCheckResult): string {
  const emoji = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
  let out = `${emoji} 健康检查 ${result.summary}\n\n`;

  for (const check of result.checks) {
    const e = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
    out += `  ${e} ${check.name}: ${check.message}\n`;
  }

  return out;
}