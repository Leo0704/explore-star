/**
 * LLM response cache
 *
 * 基于 sha256(model + systemPrompt + userPrompt) 的 in-memory cache,
 * 可选持久化到 ./data/llm-cache.jsonl (NDJSON).
 *
 * 设计:
 *   - key: sha256 hex(64 chars),由 caller 自己构造
 *   - value: { response: string, createdAt: ISO, model: string, promptHash: string }
 *   - 失败/降级:任何 IO 异常都被吞掉,只打 warning,不阻塞主流程
 *   - 单进程内存上限:不设硬上限(MVP),进程重启清空
 *
 * 不引入第三方依赖,所有 IO 走 node:fs/promises + node:crypto.
 */

import { createHash } from 'node:crypto';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'adapters/llm/_cache' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheEntry {
  response: string;
  createdAt: string;
  model: string;
  promptHash: string;
}

export interface CacheOptions {
  /** 持久化路径(可选)。提供则写入到 NDJSON 文件 */
  persistPath?: string;
  /** 是否启用持久化(默认 false) */
  persist?: boolean;
}

// ---------------------------------------------------------------------------
// Globals (in-memory cache, 单例)
// ---------------------------------------------------------------------------

const memoryCache = new Map<string, CacheEntry>();

/** 测试 hook:清空内存 cache */
export function _clearMemoryCache(): void {
  memoryCache.clear();
}

/** 测试 hook:查看当前内存 cache 大小 */
export function _memoryCacheSize(): number {
  return memoryCache.size;
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * 生成 cache key: sha256(model + '\n' + systemPrompt + '\n' + userPrompt)
 * 同样输入 → 同样 key;不同 model/system/user 不会碰撞。
 */
export function buildCacheKey(model: string, systemPrompt: string, userPrompt: string): string {
  const h = createHash('sha256');
  h.update(model);
  h.update('\n');
  h.update(systemPrompt);
  h.update('\n');
  h.update(userPrompt);
  return h.digest('hex');
}

// ---------------------------------------------------------------------------
// Lookup / Store
// ---------------------------------------------------------------------------

/**
 * 查 cache(内存 → 可选磁盘)
 * 返回 CacheEntry | null
 */
export async function cacheGet(
  key: string,
  model: string,
  opts: CacheOptions = {},
): Promise<CacheEntry | null> {
  // 1. 内存优先
  const mem = memoryCache.get(key);
  if (mem) return mem;

  // 2. 磁盘 fallback(只读,启动时不预热)
  if (opts.persist && opts.persistPath && existsSync(opts.persistPath)) {
    try {
      const raw = await readFile(opts.persistPath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      // 从后往前找(NDJSON 追加写,最新条目在尾部)
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]) as CacheEntry;
          if (entry.promptHash === key && entry.model === model) {
            // 回填到内存
            memoryCache.set(key, entry);
            return entry;
          }
        } catch {
          // 跳过损坏行
          continue;
        }
      }
    } catch (e) {
      log.warn({ err: e, path: opts.persistPath }, '读取 cache 失败,降级到无 cache');
    }
  }

  return null;
}

/**
 * 写 cache(内存 + 可选磁盘追加)
 * 失败时只 warn,不抛
 */
export async function cacheSet(
  key: string,
  entry: CacheEntry,
  opts: CacheOptions = {},
): Promise<void> {
  // 1. 内存
  memoryCache.set(key, entry);

  // 2. 磁盘(NDJSON 追加,失败降级)
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

// ---------------------------------------------------------------------------
// Convenience helper (供 adapter 用)
// ---------------------------------------------------------------------------

export interface CompleteWithCacheParams {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** 实际 fetch 函数(命中 cache 时不调用) */
  fetcher: () => Promise<string>;
  /** cache 选项(可启用持久化) */
  cacheOpts?: CacheOptions;
}

/**
 * 带 cache 的 complete 包装:
 *   1. 算 key
 *   2. 查 cache,命中直接返回
 *   3. 未命中调 fetcher,结果写 cache,返回
 */
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
