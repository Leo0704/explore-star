/**
 * RAG 索引构建器测试 (增量 + 批量)
 *
 * 验证:
 * - 首次 build 全部 embed
 * - 第二次 build, 未变文件不调用 embed, hash 变化文件重新 embed
 * - 删除文件从索引中移除
 * - embedBatch 被调用
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildKnowledgeIndex } from '../../src/rag/index-builder.js';
import type { EmbeddingProvider } from '../../src/core/types.js';

function makeMockProvider(): EmbeddingProvider {
  // Q1 切换：mock 维度跟通义 v3 默认对齐（1024）
  // 跟 src/rag/index-builder.ts:65 的 schema 保持一致
  const DIM = 1024;
  const vec = (seed: number) => {
    const out: number[] = [];
    for (let i = 0; i < DIM; i++) out.push(Math.sin(seed + i));
    return out;
  };
  let callCount = 0;
  return {
    dimensions: DIM,
    model: 'mock-embed',
    embed: vi.fn(async (text: string) => {
      callCount++;
      return vec(callCount + text.length);
    }),
    embedBatch: vi.fn(async (texts: string[]) => {
      callCount++;
      return texts.map((t, idx) => vec(callCount + idx + t.length));
    }),
  } as unknown as EmbeddingProvider;
}

describe('buildKnowledgeIndex (incremental + batch)', () => {
  let workDir: string;
  let businessDir: string;
  let knowledgeDir: string;
  let dbPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'rag-idx-'));
    businessDir = join(workDir, 'biz');
    knowledgeDir = join(businessDir, 'knowledge');
    await mkdir(knowledgeDir, { recursive: true });
    dbPath = join(workDir, 'vectors.db');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('首次 build: 全部 embed, 0 跳过', async () => {
    await writeFile(join(knowledgeDir, 'a.md'), '# A\ncontent a');
    await writeFile(join(knowledgeDir, 'b.md'), '# B\ncontent b');

    const provider = makeMockProvider();
    const r = await buildKnowledgeIndex(businessDir, provider, dbPath);

    expect(r.errors).toEqual([]);
    expect(r.docCount).toBe(2);
    expect(r.reEmbedded).toBe(2);
    expect(r.skipped).toBe(0);
    expect((provider.embedBatch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('第二次 build, 文件未变: 全部跳过, 不调 embed', async () => {
    await writeFile(join(knowledgeDir, 'a.md'), '# A\ncontent a');
    await writeFile(join(knowledgeDir, 'b.md'), '# B\ncontent b');

    const provider1 = makeMockProvider();
    await buildKnowledgeIndex(businessDir, provider1, dbPath);

    const provider2 = makeMockProvider();
    const r2 = await buildKnowledgeIndex(businessDir, provider2, dbPath);

    expect(r2.errors).toEqual([]);
    expect(r2.docCount).toBe(2);
    expect(r2.reEmbedded).toBe(0);
    expect(r2.skipped).toBe(2);
    expect((provider2.embedBatch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('第二次 build, 一个文件改动: 只重 embed 改动的那个', async () => {
    await writeFile(join(knowledgeDir, 'a.md'), '# A\ncontent a');
    await writeFile(join(knowledgeDir, 'b.md'), '# B\ncontent b');

    const provider1 = makeMockProvider();
    await buildKnowledgeIndex(businessDir, provider1, dbPath);

    // 改 b.md
    await writeFile(join(knowledgeDir, 'b.md'), '# B\ncontent b v2');

    const provider2 = makeMockProvider();
    const r2 = await buildKnowledgeIndex(businessDir, provider2, dbPath);

    expect(r2.errors).toEqual([]);
    expect(r2.docCount).toBe(2);
    expect(r2.reEmbedded).toBe(1);
    expect(r2.skipped).toBe(1);
    // 1 个改动 → 1 个 batch 调用, batch 内 1 个 text
    expect((provider2.embedBatch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    const batchArg = (provider2.embedBatch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(batchArg).toEqual(['# B\ncontent b v2']);
  });

  it('删除文件: 从索引中清除', async () => {
    await writeFile(join(knowledgeDir, 'a.md'), '# A\ncontent a');
    await writeFile(join(knowledgeDir, 'b.md'), '# B\ncontent b');

    const provider1 = makeMockProvider();
    await buildKnowledgeIndex(businessDir, provider1, dbPath);

    // 删 b.md
    const { unlink } = await import('node:fs/promises');
    await unlink(join(knowledgeDir, 'b.md'));

    const provider2 = makeMockProvider();
    const r2 = await buildKnowledgeIndex(businessDir, provider2, dbPath);

    expect(r2.docCount).toBe(1);
    expect(r2.reEmbedded).toBe(0);
    expect(r2.skipped).toBe(1);
  });

  it('embedBatch 用于 batching (不是单条 embed)', async () => {
    await writeFile(join(knowledgeDir, 'a.md'), '# A\ncontent a');
    await writeFile(join(knowledgeDir, 'b.md'), '# B\ncontent b');
    await writeFile(join(knowledgeDir, 'c.md'), '# C\ncontent c');

    const provider = makeMockProvider();
    await buildKnowledgeIndex(businessDir, provider, dbPath);

    // 应该用 batch 调用, 而不是 N 次单条 embed
    expect((provider.embedBatch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((provider.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
