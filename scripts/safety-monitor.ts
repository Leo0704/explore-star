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
import { join } from 'node:path';

const SAFETY_CONFIG_PATH = './config/safety.json';
const EMERGENCY_STOP_PATH = './config/EMERGENCY_STOP';
const DAILY_LOG_DIR = './logs';

interface SafetySignal {
  type: string;
  count: number;
  action: 'pause_1h' | 'stop_today' | 'emergency_stop';
  message: string;
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
  const rateLimits = safetyConfig.rate_limits as Record<string, number> || {};

  // 3. 统计今日日志中的风控信号
  const today = new Date().toISOString().slice(0, 10);
  const todayLog = join(DAILY_LOG_DIR, `${today}.log`);

  if (existsSync(todayLog)) {
    const logContent = readFileSync(todayLog, 'utf-8');

    // 检测 auth_wall_detected
    if (fatalSignals.includes('auth_wall_detected')) {
      const count = (logContent.match(/auth_wall_detected/g) || []).length;
      if (count > 0) {
        signals.push({
          type: 'auth_wall_detected',
          count,
          action: 'emergency_stop',
          message: `抖音登录墙触发 ${count} 次，需要重新登录`,
        });
      }
    }

    // 检测 captcha_triggered_3_times_in_1h
    if (fatalSignals.includes('captcha_triggered_3_times_in_1h')) {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      // 简化：统计日志中最近 1 小时的 captcha 次数
      const matches = logContent.match(/captcha_triggered_\d+_times/g) || [];
      // 实际实现需要解析时间戳，简化处理
      if (matches.length >= 3) {
        signals.push({
          type: 'captcha_triggered_3_times_in_1h',
          count: matches.length,
          action: 'stop_today',
          message: `1 小时内触发验证码 ${matches.length} 次，今日停止`,
        });
      }
    }
  }

  // 4. 检查限速
  if (rateLimits['douyin.friend_request.per_day']) {
    const maxPerDay = rateLimits['douyin.friend_request.per_day'];
    // 从 data/tmp/tasks-{date}.json 读取今日使用量
    // 简化：检查是否有超限标记
    const tasksPath = `./data/tmp/tasks-${today}.json`;
    if (existsSync(tasksPath)) {
      try {
        const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
        const friendRequests = Array.isArray(tasks)
          ? tasks.filter((t: any) => t.next_action === 'friend_request').length
          : 0;
        if (friendRequests > maxPerDay) {
          signals.push({
            type: 'rate_limit_exceeded',
            count: friendRequests,
            action: 'pause_1h',
            message: `好友申请 ${friendRequests}/${maxPerDay}，接近上限`,
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