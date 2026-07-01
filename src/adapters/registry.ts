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

const llmRegistry = new Map<string, LLMProvider>();
const crmRegistry = new Map<string, CRMAdapter>();
const channelRegistry = new Map<string, ChannelAdapter>();
const notifierRegistry = new Map<string, Notifier>();
const embeddingRegistry = new Map<string, EmbeddingProvider>();
const bookingRegistry = new Map<string, BookingProvider>();

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

export async function registerBuiltins(): Promise<void> {
  const llm = await import('./llm/index.js');
  const crm = await import('./crm/index.js');
  const channel = await import('./channel/index.js');
  const notifier = await import('./notifier/index.js');
  const embedding = await import('./embeddings/index.js');
  const booking = await import('./booking/index.js');

  llm.registerAll?.();
  crm.registerAll?.();
  await channel.registerAll?.();
  notifier.registerAll?.();
  embedding.registerAll?.();
  booking.registerAll?.();
}

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

interface ChannelsYamlConfig {
  channels?: Record<string, ChannelQpsLimit & {
    daily_quota?: ChannelDailyQuota;
  }>;
}

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

export function setChannelConfigPath(path: string): void {
  _explicitChannelConfigPath = path;
  _channelConfigCache = null;
  _channelConfigCachePromise = null;
}

let _channelConfigCache: ChannelsYamlConfig | null = null;
let _channelConfigCachePromise: Promise<ChannelsYamlConfig> | null = null;
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

export function _resetChannelConfigCache(): void {
  _channelConfigCache = null;
  _channelConfigCachePromise = null;
}

export function getChannelQps(name: string): number {
  const declared = _channelConfigCache?.channels?.[name]?.qps;
  if (typeof declared === 'number' && declared > 0) return declared;
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

export function getChannelDailyQuota(name: string): ChannelDailyQuota | null {
  const quota = _channelConfigCache?.channels?.[name]?.daily_quota;
  if (!quota) return null;
  return quota;
}

export async function initChannelConfigs(yamlPath?: string): Promise<void> {
  if (yamlPath) process.env.EXPLORE_STAR_CHANNELS_PATH = yamlPath;
  const cfg = await loadChannelConfigs();
  _channelConfigCache = cfg;
  _channelConfigCachePromise = Promise.resolve(cfg);
}

export async function ensureChannelConfigsLoaded(): Promise<void> {
  await getChannelConfigsAsync();
}
