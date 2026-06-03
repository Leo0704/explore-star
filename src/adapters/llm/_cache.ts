import { createHash } from 'node:crypto';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'adapters/llm/_cache' });

export interface CacheEntry {
  response: string;
  createdAt: string;
  model: string;
  promptHash: string;
}

export interface CacheOptions {
  persistPath?: string;
  persist?: boolean;
}

const memoryCache = new Map<string, CacheEntry>();

let diskIndexLoaded = false;

export function _clearMemoryCache(): void {
  memoryCache.clear();
  diskIndexLoaded = false;
}

export function _memoryCacheSize(): number {
  return memoryCache.size;
}

export function buildCacheKey(model: string, systemPrompt: string, userPrompt: string): string {
  const h = createHash('sha256');
  h.update(model);
  h.update('\n');
  h.update(systemPrompt);
  h.update('\n');
  h.update(userPrompt);
  return h.digest('hex');
}

export async function cacheGet(
  key: string,
  model: string,
  opts: CacheOptions = {},
): Promise<CacheEntry | null> {
  const mem = memoryCache.get(key);
  if (mem) return mem;

  if (opts.persist && opts.persistPath && existsSync(opts.persistPath)) {
    if (!diskIndexLoaded) {
      try {
        const raw = await readFile(opts.persistPath, 'utf-8');
        for (const line of raw.split('\n')) {
          if (!line) continue;
          try {
            const entry = JSON.parse(line) as CacheEntry;
            memoryCache.set(entry.promptHash, entry);
          } catch {
            continue;
          }
        }
        diskIndexLoaded = true;
      } catch (e) {
        log.warn({ err: e, path: opts.persistPath }, '读取 cache 失败,降级到无 cache');
      }
    }
    const hit = memoryCache.get(key);
    if (hit && hit.model === model) return hit;
  }

  return null;
}

export async function cacheSet(
  key: string,
  entry: CacheEntry,
  opts: CacheOptions = {},
): Promise<void> {
  memoryCache.set(key, entry);

  if (opts.persist && opts.persistPath) {
    try {
      const dir = dirname(opts.persistPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await appendFile(opts.persistPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (e) {
      log.warn({ err: e, path: opts.persistPath }, '写入 cache 失败');
    }
  }
}

export interface CompleteWithCacheParams {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  fetcher: () => Promise<string>;
  cacheOpts?: CacheOptions;
}

export async function completeWithCache(
  params: CompleteWithCacheParams,
): Promise<string> {
  const key = buildCacheKey(params.model, params.systemPrompt, params.userPrompt);

  const cached = await cacheGet(key, params.model, params.cacheOpts);
  if (cached) {
    return cached.response;
  }

  const response = await params.fetcher();
  await cacheSet(key, {
    response,
    createdAt: new Date().toISOString(),
    model: params.model,
    promptHash: key,
  }, params.cacheOpts);
  return response;
}
