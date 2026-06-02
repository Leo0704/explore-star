/**
 * cache-bust CLI 子命令
 *
 * 用法: npx explore-star cache-bust
 * 行为: 删除 ./data/llm-cache.jsonl 整个文件（MVP 简化方案；roadmap §4 风险表）
 *
 * 简化说明:按 business 过滤 cache entry 需要 cache key 含 business 维度,
 *   当前 sha256(model+system+user) 不含 business。
 *   Phase 4 候选:cache key 加 business 维度,cache-bust --business <dir> 才能精确清。
 */

import { existsSync, unlinkSync } from 'node:fs';
import { showUsage, selfInvoke } from './_shared.js';

const USAGE = `
用法: npx explore-star cache-bust

清空 ./data/llm-cache.jsonl 中的所有缓存条目（roadmap §4 风险表：缓存 stale 时手动清理）。
`;

export async function runCacheBust(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const cachePath = './data/llm-cache.jsonl';
  if (existsSync(cachePath)) {
    unlinkSync(cachePath);
    console.log(`[cache-bust] 已删除 ${cachePath}`);
  } else {
    console.log(`[cache-bust] ${cachePath} 不存在，无需清理`);
  }
}

export async function runCLI(args: string[]): Promise<void> {
  await runCacheBust(args);
}

selfInvoke(import.meta.url, runCLI);
