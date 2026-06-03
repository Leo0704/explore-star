/**
 * 健康检查（§5.4 4 类告警）
 *
 * V1.4 实现：
 *   - checkSystemHealth: 系统基本状态（磁盘/cron/日志）
 *   - checkAdapterHealth: 各 adapter 连通性（LLM/CRM/Channel/Notifier）
 *   - checkSafetyLimits: 今日限速状态（任务数/好友数/私信数）
 *   - checkEmergencyStop: 紧急停止开关
 */

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

// ---------------------------------------------------------------------------
// 4 类健康检查
// ---------------------------------------------------------------------------

/**
 * 全面健康检查
 */
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

/**
 * §5.4.1 系统基本状态（磁盘/cron/日志）
 */
export async function checkSystemHealth(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = [];

  // 磁盘空间检查 —— 用 statfs 读真实剩余空间（Node 18.15+）
  // 修复 Bug 17：之前硬编码 10GB，永远 ok，state machine 在撒谎
  try {
    const dataPath = './data';
    if (existsSync(dataPath)) {
      // statSync 用于确认 path 存在；statfs 才是真实磁盘空间
      statSync(dataPath);
      let realFreeGb = 0;
      if (typeof statfsSync === 'function') {
        // statfs 返回 bytes：bsize * bfree
        const stats = statfsSync(dataPath);
        realFreeGb = (stats.bsize * stats.bfree) / 1024 / 1024 / 1024;
      }
      // realFreeGb = 0 → statfs 不可用（fail-loud，不伪造 ok）
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

  // 日志目录检查
  const logPath = './logs';
  if (existsSync(logPath)) {
    checks.push({ name: 'log_dir', status: 'ok', message: '日志目录存在' });
  } else {
    checks.push({ name: 'log_dir', status: 'warning', message: '日志目录不存在，将自动创建' });
  }

  // 最近运行检查
  const todayLog = join('./logs', `${new Date().toISOString().slice(0, 10)}.log`);
  if (existsSync(todayLog)) {
    checks.push({ name: 'today_log', status: 'ok', message: '今日日志文件存在' });
  } else {
    checks.push({ name: 'today_log', status: 'warning', message: '今日尚未运行' });
  }

  const hasCritical = checks.some(c => c.status === 'critical');
  return {
    status: hasCritical ? 'critical' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok',
    checks,
    summary: `系统检查：${checks.filter(c => c.status === 'ok').length}/${checks.length} 通过`,
  };
}

/**
 * §5.4.2 各 adapter 连通性
 */
export async function checkAdapterHealth(businessDir?: string): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = [];

  // LLM 检查
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

  // CRM 检查（从业务配置读取实际 CRM 类型）
  let crmType = 'csv';
  if (businessDir) {
    try {
      const { profile } = await loadBusinessProfile(businessDir);
      crmType = profile.crm.type;
    } catch { /* fallback csv */ }
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

  // Channel 检查
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

  // Notifier 检查
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

/**
 * §5.4.3 今日限速状态
 */
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
    // 使用默认值
  }

  const budget = safetyConfig.daily_budget as Record<string, number> || {};
  const limits = safetyConfig.rate_limits as Record<string, unknown> || {};

  // 从 data/tmp/tasks-{date}.json 读取今日任务数
  const tasksPath = `./data/tmp/tasks-${today}.json`;
  let todayTasks = 0;
  if (existsSync(tasksPath)) {
    try {
      const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
      todayTasks = Array.isArray(tasks) ? tasks.length : 0;
    } catch {
      // 忽略
    }
  }

  const maxTasks = (budget.engagement_actions as number) || 20;
  checks.push({
    name: 'daily_tasks',
    status: todayTasks < maxTasks ? 'ok' : 'critical',
    message: `今日任务 ${todayTasks}/${maxTasks}`,
    details: { used: todayTasks, limit: maxTasks },
  });

  // 好友申请 / 私信配额（从 rate-counters 文件读取）
  const douyinLimits = (limits?.douyin as Record<string, number>) || {};
  const countersPath = `./data/rate-counters-${today}.json`;
  let counters = { friend_requests_today: 0, dm_today: 0 };
  if (existsSync(countersPath)) {
    try {
      counters = JSON.parse(readFileSync(countersPath, 'utf-8'));
    } catch { /* ignore */ }
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

/**
 * §5.4.4 紧急停止开关
 */
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

// ---------------------------------------------------------------------------
// CLI 输出格式化
// ---------------------------------------------------------------------------

export function formatHealthReport(result: HealthCheckResult): string {
  const emoji = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
  let out = `${emoji} 健康检查 ${result.summary}\n\n`;

  for (const check of result.checks) {
    const e = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
    out += `  ${e} ${check.name}: ${check.message}\n`;
  }

  return out;
}