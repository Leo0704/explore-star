/**
 * cache-bust CLI 测试
 *
 * Phase 2 #4:roadmap §4 风险表 —— 缓存导致 stale 结果时,提供手动清空入口
 * MVP 简化:清整个 ./data/llm-cache.jsonl
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cache-bust-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  mkdirSync('./data', { recursive: true });
  writeFileSync('./data/llm-cache.jsonl', '{"x":1}\n{"x":2}\n');
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('cache-bust', () => {
  it('删除 ./data/llm-cache.jsonl', async () => {
    const { runCacheBust } = await import('../../src/cli/cache-bust.js');
    expect(existsSync('./data/llm-cache.jsonl')).toBe(true);
    await runCacheBust([]);
    expect(existsSync('./data/llm-cache.jsonl')).toBe(false);
  });

  it('文件不存在时,优雅跳过', async () => {
    const { runCacheBust } = await import('../../src/cli/cache-bust.js');
    rmSync('./data/llm-cache.jsonl');
    expect(() => runCacheBust([])).not.toThrow();
  });
});
