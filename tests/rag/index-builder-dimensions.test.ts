/**
 * Bug 22 (P0)：RAG index-builder hardcoded float[1024] schema.
 *
 * 当用户使用非 1024 维的 embedding（OpenAI text-embedding-3-small = 1536 维）
 * 时，CREATE TABLE 用硬编码 float[1024] 会让 INSERT 失败。
 *
 * 修复：CREATE TABLE 必须用 embeddingProvider.dimensions。
 *
 * 用法：建一个临时 sqlite-vec DB，建表后用 PRAGMA table_info 查 column 类型。
 * sqlite-vec 的 vec0 virtual table 的 embedding 列会声明为 "float[DIM]"。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { load as loadSqliteVec } from 'sqlite-vec';
import { buildKnowledgeIndex } from '../../src/rag/index-builder.js';
import type { EmbeddingProvider } from '../../src/core/types.js';

function makeProviderWithDim(dim: number): EmbeddingProvider {
  const vec = (seed: number) => {
    const out: number[] = [];
    for (let i = 0; i < dim; i++) out.push(Math.sin(seed + i));
    return out;
  };
  let callCount = 0;
  return {
    dimensions: dim,
    model: `mock-${dim}d`,
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

function readEmbeddingColumnType(dbPath: string): string | null {
  const db = new Database(dbPath);
  try {
    loadSqliteVec(db);
    const rows = db.prepare(
      `SELECT type FROM pragma_table_info('knowledge_vectors') WHERE name = 'embedding'`,
    ).all() as Array<{ type: string }>;
    return rows[0]?.type ?? null;
  } finally {
    db.close();
  }
}

describe('buildKnowledgeIndex — Bug 22: dynamic dimensions from embeddingProvider', () => {
  let workDir: string;
  let businessDir: string;
  let knowledgeDir: string;
  let dbPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'rag-dim-'));
    businessDir = join(workDir, 'biz');
    knowledgeDir = join(businessDir, 'knowledge');
    await mkdir(knowledgeDir, { recursive: true });
    dbPath = join(workDir, 'vectors.db');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('OpenAI 1536 维: schema 必须是 float[1536]，不是 float[1024]', async () => {
    await writeFile(join(knowledgeDir, 'a.md'), '# A');

    const provider = makeProviderWithDim(1536);
    const r = await buildKnowledgeIndex(businessDir, provider, dbPath);

    expect(r.errors).toEqual([]);
    expect(r.docCount).toBe(1);

    const colType = readEmbeddingColumnType(dbPath);
    expect(colType).toBe('float[1536]');
  });

  it('Qwen 1024 维（默认）: schema 是 float[1024]', async () => {
    await writeFile(join(knowledgeDir, 'a.md'), '# A');

    const provider = makeProviderWithDim(1024);
    const r = await buildKnowledgeIndex(businessDir, provider, dbPath);

    expect(r.errors).toEqual([]);
    const colType = readEmbeddingColumnType(dbPath);
    expect(colType).toBe('float[1024]');
  });

  it('非默认 768 维: schema 是 float[768]（防止硬编码回归）', async () => {
    await writeFile(join(knowledgeDir, 'a.md'), '# A');

    const provider = makeProviderWithDim(768);
    const r = await buildKnowledgeIndex(businessDir, provider, dbPath);

    expect(r.errors).toEqual([]);
    const colType = readEmbeddingColumnType(dbPath);
    expect(colType).toBe('float[768]');
  });
});
