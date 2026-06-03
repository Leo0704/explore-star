/**
 * Adapter 注册中心
 *
 * 探星支持 5 类 Adapter：
 *   - LLM:    OpenAI / DeepSeek / Anthropic / Ollama / 自定义
 *   - CRM:    飞书 / Notion / Airtable / CSV / 自定义
 *   - Channel: 抖音（V1）/ 小红书/B站（V2）/ 自定义
 *   - Notifier: 微信 / 飞书 / 邮件 / Slack / 自定义
 *   - Embeddings: OpenAI / 本地 bge / 自定义
 *
 * 注册流程：
 *   1. 启动时 `registerBuiltins()` 注册内置实现
 *   2. `loadUserAdapters(BUSINESS_DIR)` 加载 `business/adapters/<type>/*.ts`
 *      业务方自定义的同名 Adapter 会**覆盖**内置实现
 *   3. 业务代码通过 `getLLM(name)` / `getCRM(name)` 等工厂方法获取实例
 */

import type {
  LLMProvider, CRMAdapter, ChannelAdapter, Notifier, EmbeddingProvider,
  ChannelQpsLimit, ChannelDailyQuota,
} from '../core/types.js';
import type { BookingProvider } from './booking/base.js';
import { logger } from '../core/logger.js';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { resolve as resolvePath } from 'node:path';

const log = logger.child({ module: 'adapters/registry' });

// 6 个 Map 维护实例池（按 name 索引）
const llmRegistry = new Map<string, LLMProvider>();
const crmRegistry = new Map<string, CRMAdapter>();
const channelRegistry = new Map<string, ChannelAdapter>();
const notifierRegistry = new Map<string, Notifier>();
const embeddingRegistry = new Map<string, EmbeddingProvider>();
const bookingRegistry = new Map<string, BookingProvider>();

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------
export function registerLLM(name: string, impl: LLMProvider): void {
  if (llmRegistry.has(name)) {
    log.warn({ name }, 'LLM 重复注册，将覆盖');
  }
  llmRegistry.set(name, impl);
}

export function getLLM(name: string): LLMProvider {
  const impl = llmRegistry.get(name);
  if (!impl) {
    throw new Error(`LLM adapter "${name}" 未注册。可用：${[...llmRegistry.keys()].join(', ')}`);
  }
  return impl;
}

export function listLLMs(): string[] {
  return [...llmRegistry.keys()];
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------
export function registerCRM(name: string, impl: CRMAdapter): void {
  if (crmRegistry.has(name)) {
    log.warn({ name }, 'CRM 重复注册，将覆盖');
  }
  crmRegistry.set(name, impl);
}

export function getCRM(name: string): CRMAdapter {
  const impl = crmRegistry.get(name);
  if (!impl) {
    throw new Error(`CRM adapter "${name}" 未注册。可用：${[...crmRegistry.keys()].join(', ')}`);
  }
  return impl;
}

export function listCRMs(): string[] {
  return [...crmRegistry.keys()];
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------
export function registerChannel(name: string, impl: ChannelAdapter): void {
  channelRegistry.set(name, impl);
}

export function getChannel(name: string): ChannelAdapter {
  const impl = channelRegistry.get(name);
  if (!impl) {
    throw new Error(`Channel adapter "${name}" 未注册。可用：${[...channelRegistry.keys()].join(', ')}`);
  }
  return impl;
}

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------
export function registerNotifier(name: string, impl: Notifier): void {
  notifierRegistry.set(name, impl);
}

export function getNotifier(name: string): Notifier {
  const impl = notifierRegistry.get(name);
  if (!impl) {
    throw new Error(`Notifier adapter "${name}" 未注册。可用：${[...notifierRegistry.keys()].join(', ')}`);
  }
  return impl;
}

export function listNotifiers(): string[] {
  return [...notifierRegistry.keys()];
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------
export function registerEmbedding(name: string, impl: EmbeddingProvider): void {
  embeddingRegistry.set(name, impl);
}

export function getEmbedding(name: string): EmbeddingProvider {
  const impl = embeddingRegistry.get(name);
  if (!impl) {
    throw new Error(`Embedding adapter "${name}" 未注册。可用：${[...embeddingRegistry.keys()].join(', ')}`);
  }
  return impl;
}

export function listEmbeddings(): string[] {
  return [...embeddingRegistry.keys()];
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------
export function registerBookingProvider(name: string, impl: BookingProvider): void {
  bookingRegistry.set(name, impl);
}

export function getBookingProvider(name: string): BookingProvider {
  const impl = bookingRegistry.get(name);
  if (!impl) {
    throw new Error(`Booking provider "${name}" 未注册。可用：${[...bookingRegistry.keys()].join(', ')}`);
  }
  return impl;
}

export function listBookingProviders(): string[] {
  return [...bookingRegistry.keys()];
}

// ---------------------------------------------------------------------------
// 内置注册（按环境变量条件注册所有已实现的 adapter）
// ---------------------------------------------------------------------------
export async function registerBuiltins(): Promise<void> {
  // 动态 import 避免循环依赖
  const llm = await import('./llm/index.js');
  const crm = await import('./crm/index.js');
  const channel = await import('./channel/index.js');
  const notifier = await import('./notifier/index.js');
  const embedding = await import('./embeddings/index.js');
  const booking = await import('./booking/index.js');

  llm.registerAll?.();
  crm.registerAll?.();
  channel.registerAll?.();
  notifier.registerAll?.();
  embedding.registerAll?.();
  booking.registerAll?.();
}

// ---------------------------------------------------------------------------
// 健康检查
// ---------------------------------------------------------------------------
export async function healthCheckAll(): Promise<Record<string, { ok: boolean; detail?: string }>> {
  const results: Record<string, { ok: boolean; detail?: string }> = {};

  for (const [name, llm] of llmRegistry.entries()) {
    try {
      const r = await llm.ping();
      results[`llm:${name}`] = { ok: r.ok, detail: `latency=${r.latency_ms}ms` };
    } catch (e) {
      results[`llm:${name}`] = { ok: false, detail: String(e) };
    }
  }

  for (const [name, crm] of crmRegistry.entries()) {
    try {
      const ok = await crm.ping();
      results[`crm:${name}`] = { ok };
    } catch (e) {
      results[`crm:${name}`] = { ok: false, detail: String(e) };
    }
  }

  for (const [name, ch] of channelRegistry.entries()) {
    try {
      const r = await ch.ping();
      results[`channel:${name}`] = { ok: r.ok, detail: r.loggedIn ? 'logged in' : 'not logged in' };
    } catch (e) {
      results[`channel:${name}`] = { ok: false, detail: String(e) };
    }
  }

  for (const [name, bp] of bookingRegistry.entries()) {
    try {
      const ok = await bp.ping();
      results[`booking:${name}`] = { ok };
    } catch (e) {
      results[`booking:${name}`] = { ok: false, detail: String(e) };
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Phase 3 #5：channel 配置 hook（占位实现，1.x 之后用）
// ---------------------------------------------------------------------------

/** channels.yaml 的 `channels` 节点形状（仅我们关心的字段） */
interface ChannelsYamlConfig {
  channels?: Record<string, ChannelQpsLimit & {
    daily_quota?: ChannelDailyQuota;
  }>;
}

/**
 * 加载 channels.yaml 里的 `channels.<name>` 节点。
 *
 * 路径优先级（不抛错，找不到就返回 {}）：
 *   1. `setChannelConfigPath()` 显式注入（业务侧 run-daily 启动时调）
 *   2. `process.env.EXPLORE_STAR_CHANNELS_PATH`（测试用）
 *   3. `./channels.yaml`（CWD 相对，业务运行时默认；保持向后兼容）
 *
 * 加载失败（文件不存在 / 解析失败）→ 静默返回 {}，不阻塞业务。
 */
async function loadChannelConfigs(): Promise<ChannelsYamlConfig> {
  const yamlPath = _explicitChannelConfigPath
    ?? process.env.EXPLORE_STAR_CHANNELS_PATH
    ?? resolvePath('./channels.yaml');
  try {
    const raw = await readFile(yamlPath, 'utf-8');
    const parsed = parseYaml(raw) as ChannelsYamlConfig | null | undefined;
    return parsed?.channels ? { channels: parsed.channels } : {};
  } catch {
    return {};
  }
}

/** Bug 20：显式设置 channels.yaml 路径（覆盖 env / CWD 默认）。同步 set，调用后失效缓存。 */
export function setChannelConfigPath(path: string): void {
  _explicitChannelConfigPath = path;
  // 失效缓存：下次 getChannelQps 走新路径
  _channelConfigCache = null;
  _channelConfigCachePromise = null;
}

/** 进程级缓存（避免每个调用都读盘） */
let _channelConfigCache: ChannelsYamlConfig | null = null;
let _channelConfigCachePromise: Promise<ChannelsYamlConfig> | null = null;
/** Bug 20：显式注入的 channels.yaml 路径（run-daily 用，业务目录下 channels.yaml） */
let _explicitChannelConfigPath: string | null = null;

async function getChannelConfigsAsync(): Promise<ChannelsYamlConfig> {
  if (_channelConfigCache) return _channelConfigCache;
  if (!_channelConfigCachePromise) {
    _channelConfigCachePromise = loadChannelConfigs().then((c) => {
      _channelConfigCache = c;
      return c;
    });
  }
  return _channelConfigCachePromise;
}

/** 测试用：清缓存（让 EXPLORE_STAR_CHANNELS_PATH 变更后立即生效） */
export function _resetChannelConfigCache(): void {
  _channelConfigCache = null;
  _channelConfigCachePromise = null;
}

/**
 * 同步读取 channel 声明的 QPS 上限。
 * 启动时需先调 `initChannelConfigs()` 让缓存命中；
 * 未初始化时自动 fallback 到 `ChannelAdapter.rateLimits` 推导，再不济返回 1。
 *
 * 给 #2 rate-limiter 用。
 */
export function getChannelQps(name: string): number {
  // 1. yaml 显式声明
  const declared = _channelConfigCache?.channels?.[name]?.qps;
  if (typeof declared === 'number' && declared > 0) return declared;
  // 2. 兜底：从 rateLimits 推导（最严动作的小时上限 / 3600）
  const ch = channelRegistry.get(name);
  if (ch) {
    const rl = ch.rateLimits;
    const perHour = Math.min(
      rl.search_per_hour || Infinity,
      rl.user_videos_per_hour || Infinity,
      rl.comment_per_hour || Infinity,
    );
    if (Number.isFinite(perHour) && perHour > 0) {
      return Math.max(0.001, perHour / 3600);
    }
  }
  return 1;
}

/**
 * 同步读取 channel 声明的每日配额。
 * 给 #2 rate-limiter + status 命令用。
 *
 * 返回 null 表示无限制。
 */
export function getChannelDailyQuota(name: string): ChannelDailyQuota | null {
  const quota = _channelConfigCache?.channels?.[name]?.daily_quota;
  if (!quota) return null;
  return quota;
}

/**
 * 初始化 channel 配置缓存（启动时调用一次，让 getChannelQps / getChannelDailyQuota 同步可用）。
 * 失败静默——hook 不阻塞业务。
 */
export async function initChannelConfigs(yamlPath?: string): Promise<void> {
  if (yamlPath) process.env.EXPLORE_STAR_CHANNELS_PATH = yamlPath;
  const cfg = await loadChannelConfigs();
  _channelConfigCache = cfg;
  _channelConfigCachePromise = Promise.resolve(cfg);
}

/** 内部：异步等价的 getChannelQps（用于 #2 rate-limiter 启动时拿数据） */
export async function ensureChannelConfigsLoaded(): Promise<void> {
  await getChannelConfigsAsync();
}
