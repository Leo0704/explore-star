#!/usr/bin/env node
/**
 * 安全监控脚本（§5 风控信号检测）
 *
 * V1.4 实现：
 *   - 监控 config/safety.json 中的 rate_limits
 *   - 检测 fatal_signals
 *   - 紧急停止开关检测
 *   - 生成告警报告
 */

import { existsSync, readFileSync } from 'node:fs';

const SAFETY_CONFIG_PATH = './config/safety.json';
const EMERGENCY_STOP_PATH = './config/EMERGENCY_STOP';
const RISK_SIGNALS_LOG = './logs/risk-signals.jsonl';
const ONE_HOUR_MS = 60 * 60 * 1000;

interface SafetySignal {
  type: string;
  count: number;
  action: 'pause_1h' | 'stop_today' | 'emergency_stop';
  message: string;
}

interface RiskSignalEntry {
  type: string;
  ts: number;
}

/**
 * 加载风控信号日志（如不存在则返回空数组）
 */
function loadRiskSignals(path: string): RiskSignalEntry[] {
  if (!existsSync(path)) return [];
  try {
    const content = readFileSync(path, 'utf-8');
    const entries: RiskSignalEntry[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as RiskSignalEntry;
        if (parsed && typeof parsed.type === 'string' && typeof parsed.ts === 'number') {
          entries.push(parsed);
        }
      } catch {
        // 忽略单行解析错误
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * 统计 1 小时窗口内指定信号数量
 */
function countInLastHour(entries: RiskSignalEntry[], signalType: string, now: number): number {
  const cutoff = now - ONE_HOUR_MS;
  let count = 0;
  for (const e of entries) {
    if (e.type === signalType && e.ts >= cutoff && e.ts <= now) {
      count++;
    }
  }
  return count;
}

/**
 * 运行安全监控
 */
export function runSafetyMonitor(): SafetySignal[] {
  const signals: SafetySignal[] = [];

  // 1. 检查紧急停止开关
  if (existsSync(EMERGENCY_STOP_PATH)) {
    signals.push({
      type: 'emergency_stop',
      count: 1,
      action: 'emergency_stop',
      message: '紧急停止开关已启用',
    });
    console.error('🛑 紧急停止：config/EMERGENCY_STOP 文件存在，系统停止');
    return signals;
  }

  // 2. 加载安全配置
  let safetyConfig: Record<string, unknown> = {};
  if (existsSync(SAFETY_CONFIG_PATH)) {
    try {
      safetyConfig = JSON.parse(readFileSync(SAFETY_CONFIG_PATH, 'utf-8'));
    } catch {
      console.warn('[safety-monitor] 无法解析 safety.json');
    }
  }

  const fatalSignals = (safetyConfig.fatal_signals as string[]) || [];
  const rateLimits = (safetyConfig.rate_limits as Record<string, any>) || {};

  // 3. 加载风控信号日志（如不存在则优雅返回空数组）
  const riskEntries = loadRiskSignals(RISK_SIGNALS_LOG);
  const now = Date.now();

  // 检测 auth_wall_detected（致命信号，1 次即停）
  if (fatalSignals.includes('auth_wall_detected') && riskEntries.length > 0) {
    const count = countInLastHour(riskEntries, 'auth_wall_detected', now);
    if (count > 0) {
      signals.push({
        type: 'auth_wall_detected',
        count,
        action: 'emergency_stop',
        message: `抖音登录墙触发 ${count} 次，需要重新登录`,
      });
    }
  }

  // 检测 captcha_triggered_3_times_in_1h（1 小时内 ≥3 次验证码）
  if (fatalSignals.includes('captcha_triggered_3_times_in_1h')) {
    const count = countInLastHour(riskEntries, 'captcha', now);
    if (count >= 3) {
      signals.push({
        type: 'captcha_triggered_3_times_in_1h',
        count,
        action: 'stop_today',
        message: `1 小时内触发验证码 ${count} 次，今日停止`,
      });
    }
  }

  // 4. 检查限速（嵌套配置：rate_limits.douyin.friend_request_per_day）
  const douyinLimits = rateLimits.douyin as Record<string, number> | undefined;
  const maxFriendRequestsPerDay = douyinLimits?.friend_request_per_day;
  if (typeof maxFriendRequestsPerDay === 'number') {
    // 从 data/tmp/tasks-{date}.json 读取今日使用量
    const today = new Date().toISOString().slice(0, 10);
    const tasksPath = `./data/tmp/tasks-${today}.json`;
    if (existsSync(tasksPath)) {
      try {
        const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
        const friendRequests = Array.isArray(tasks)
          ? tasks.filter((t: any) => t.next_action === 'friend_request').length
          : 0;
        if (friendRequests > maxFriendRequestsPerDay) {
          signals.push({
            type: 'rate_limit_exceeded',
            count: friendRequests,
            action: 'pause_1h',
            message: `好友申请 ${friendRequests}/${maxFriendRequestsPerDay}，接近上限`,
          });
        }
      } catch {
        // 忽略
      }
    }
  }

  // 5. 输出报告
  if (signals.length === 0) {
    console.log('✅ 安全监控：未检测到风险信号');
  } else {
    console.warn('⚠️  安全告警：');
    for (const s of signals) {
      const emoji = s.action === 'emergency_stop' ? '🛑' : s.action === 'stop_today' ? '⛔' : '⚠️';
      console.warn(`  ${emoji} [${s.type}] ${s.message}（${s.count} 次）`);
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const signals = runSafetyMonitor();
  const hasEmergency = signals.some(s => s.action === 'emergency_stop');
  if (hasEmergency) process.exit(1);
}

runSafetyMonitor();
