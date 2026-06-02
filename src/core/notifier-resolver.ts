/**
 * Notifier 多通道解析
 *
 * 设计：
 *   - 从 profile.yaml observability.notifier.channels 读通道列表
 *   - 默认 ['console']（兜底，绝不静默丢告警）
 *   - 未注册的 channel log warn 跳过；全失败 → 兜底 console
 *   - channels=[] 视为用户配错，抛错（明示而不是默默用 console）
 */

import type { BusinessProfile, Notifier } from './types.js';
import { getNotifier } from '../adapters/registry.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'notifier-resolver' });

const DEFAULT_CHANNELS = ['console'];

export function resolveNotifiers(profile: BusinessProfile): Notifier[] {
  const notifierCfg = profile.observability?.notifier;
  if (notifierCfg?.enabled === false) return [];

  let channels: string[];
  if (notifierCfg?.channels === undefined) {
    channels = DEFAULT_CHANNELS;
  } else {
    if (notifierCfg.channels.length === 0) {
      throw new Error('observability.notifier.channels 至少配置 1 个通道（留空 = 显式 disable，请用 enabled: false）');
    }
    channels = notifierCfg.channels;
  }

  const resolved: Notifier[] = [];
  for (const name of channels) {
    try {
      resolved.push(getNotifier(name));
    } catch (e) {
      log.warn({ channel: name, err: e instanceof Error ? e.message : String(e) }, 'notifier 通道未注册或解析失败，跳过');
    }
  }

  // 全失败 → 兜底 console（绝不静默丢告警，channels 显式配了但全失败也算）
  if (resolved.length === 0) {
    log.error({ channels }, '所有配置的 notifier 通道均失败，回退到 console 兜底');
    try {
      resolved.push(getNotifier('console'));
    } catch (e) {
      log.error({ err: e }, '兜底 console notifier 也无法注册，告警完全无法送达');
    }
  }

  return resolved;
}
