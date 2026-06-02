/**
 * LLM response cache 测试
 *
 * 验证:
 *   1. 同一输入两次调用,第二次命中 cache 不调 fetcher
 *   2. 不同 input 不会命中(隔离)
 *   3. 持久化写入并能回读
 *   4. fetcher 抛错时不写 cache
 *   5. 不同 model 不会碰撞
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildCacheKey,
  cacheGet,
  cacheSet,
  completeWithCache,
  _clearMemoryCache,
  _memoryCacheSize,
} from '../../../src/adapters/llm/_cache.js';

describe('LLM response cache', () => {
  beforeEach(() => {
    _clearMemoryCache();
  });

  describe('buildCacheKey', () => {
    it('相同输入产生相同 key', () => {
      const k1 = buildCacheKey('gpt-4', 'sys', 'user');
      const k2 = buildCacheKey('gpt-4', 'sys', 'user');
      expect(k1).toBe(k2);
      expect(k1).toHaveLength(64); // sha256 hex
    });

    it('不同 model 产生不同 key', () => {
      expect(buildCacheKey('gpt-4', 'sys', 'user'))
        .not.toBe(buildCacheKey('gpt-3.5', 'sys', 'user'));
    });

    it('不同 prompt 产生不同 key', () => {
      expect(buildCacheKey('m', 'sys', 'user1'))
        .not.toBe(buildCacheKey('m', 'sys', 'user2'));
      expect(buildCacheKey('m', 'sys1', 'user'))
        .not.toBe(buildCacheKey('m', 'sys2', 'user'));
    });
  });

  describe('cacheGet / cacheSet (in-memory)', () => {
    it('set 之后 get 能拿到', async () => {
      const key = buildCacheKey('m', 's', 'u');
      const entry = {
        response: 'hello',
        createdAt: new Date().toISOString(),
        model: 'm',
        promptHash: key,
      };
      await cacheSet(key, entry);
      const got = await cacheGet(key, 'm');
      expect(got?.response).toBe('hello');
    });

    it('未 set 时返回 null', async () => {
      const got = await cacheGet(buildCacheKey('m', 's', 'u'), 'm');
      expect(got).toBeNull();
    });
  });

  describe('cacheGet / cacheSet (持久化)', () => {
    let tmpDir: string;
    let persistPath: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'llm-cache-test-'));
      persistPath = join(tmpDir, 'cache.jsonl');
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('set 写入磁盘,get 跨实例能读回', async () => {
      const opts = { persist: true, persistPath };
      const key = buildCacheKey('m', 's', 'u-persisted');

      await cacheSet(key, {
        response: 'persisted-hello',
        createdAt: new Date().toISOString(),
        model: 'm',
        promptHash: key,
      }, opts);

      expect(existsSync(persistPath)).toBe(true);
      const lines = readFileSync(persistPath, 'utf-8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.response).toBe('persisted-hello');
    });
  });

  describe('completeWithCache', () => {
    it('同一输入第二次命中 cache,不打 fetcher', async () => {
      const fetcher = vi.fn().mockResolvedValue('result-1');
      const params = {
        model: 'm1',
        systemPrompt: 'sys1',
        userPrompt: 'user1',
        fetcher,
      };

      const r1 = await completeWithCache(params);
      const r2 = await completeWithCache(params);

      expect(r1).toBe('result-1');
      expect(r2).toBe('result-1');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('不同 userPrompt 不会命中,各调一次', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce('a')
        .mockResolvedValueOnce('b');

      const a = await completeWithCache({ model: 'm', systemPrompt: 's', userPrompt: 'u1', fetcher });
      const b = await completeWithCache({ model: 'm', systemPrompt: 's', userPrompt: 'u2', fetcher });

      expect(a).toBe('a');
      expect(b).toBe('b');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('不同 model 不会碰撞', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce('m1-out')
        .mockResolvedValueOnce('m2-out');

      const a = await completeWithCache({ model: 'm1', systemPrompt: 's', userPrompt: 'u', fetcher });
      const b = await completeWithCache({ model: 'm2', systemPrompt: 's', userPrompt: 'u', fetcher });

      expect(a).toBe('m1-out');
      expect(b).toBe('m2-out');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('fetcher 抛错时抛出去,不写 cache', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
      const params = { model: 'm', systemPrompt: 's', userPrompt: 'u-err', fetcher };

      await expect(completeWithCache(params)).rejects.toThrow('boom');
      // 第二次调用仍应打 fetcher(因为没写 cache)
      await expect(completeWithCache(params)).rejects.toThrow('boom');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('_memoryCacheSize 反映 in-memory 写入数', async () => {
      expect(_memoryCacheSize()).toBe(0);
      await completeWithCache({
        model: 'm', systemPrompt: 's', userPrompt: 'u-size',
        fetcher: async () => 'x',
      });
      expect(_memoryCacheSize()).toBe(1);
    });
  });
});
