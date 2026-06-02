/**
 * RAG 索引构建器
 *
 * 扫描 business.example/燃点-FDE/knowledge/ 下的 .md 文件，
 * 整文件向量化，入 sqlite-vec 索引库（data/vectors.db）。
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import Database from 'better-sqlite3';
import { load as loadSqliteVec } from 'sqlite-vec';
import type { EmbeddingProvider } from '../core/types.js';

export interface IndexResult {
  dbPath: string;
  docCount: number;
  errors: string[];
}

/**
 * 构建知识库向量索引
 *
 * @param businessDir  业务目录（如 ./business.example/燃点-FDE）
 * @param embeddingProvider  向量模型 provider
 * @param dbPath  输出 sqlite-vec 数据库路径
 */
export async function buildKnowledgeIndex(
  businessDir: string,
  embeddingProvider: EmbeddingProvider,
  dbPath: string = './data/vectors.db',
): Promise<IndexResult> {
  const knowledgeDir = join(businessDir, 'knowledge');
  const errors: string[] = [];

  // 扫描所有 .md 文件（整文件不切分）
  const mdFiles = await listMarkdownFiles(knowledgeDir);
  if (mdFiles.length === 0) {
    return { dbPath, docCount: 0, errors: ['knowledge 目录为空或不存在'] };
  }

  // 向量化 + 写入 sqlite-vec
  const docs: Array<{ path: string; content: string; embedding: number[] }> = [];

  for (const file of mdFiles) {
    try {
      const content = await readFile(file, 'utf-8');
      const embedding = await embeddingProvider.embed(content);
      docs.push({
        path: relative(knowledgeDir, file),
        content,
        embedding,
      });
    } catch (e) {
      errors.push(`文件 ${file} 向量化失败: ${e}`);
    }
  }

  // 建库 & 建表
  const db = new Database(dbPath);
  try {
    // 启用 sqlite-vec 扩展（用包 helper 解析平台对应的 .dylib 绝对路径）
    loadSqliteVec(db);

    // 创建 virtual table
    // Q1 切换：维度 1536（OpenAI）→ 1024（通义 v3 默认）
    // 跟 src/adapters/embeddings/qwen.ts 的 dimensions 字段保持一致
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vectors USING vec0(
        path TEXT PRIMARY KEY,
        content TEXT,
        embedding float[1024]
      );
    `);

    // 清空旧数据（重建索引）
    db.exec('DELETE FROM knowledge_vectors;');

    // 写入新数据
    const insert = db.prepare(
      'INSERT INTO knowledge_vectors (path, content, embedding) VALUES (?, ?, ?)',
    );

    for (const doc of docs) {
      // embedding 序列化为 Float32 BLOB
      const embeddingBlob = Buffer.from(new Float32Array(doc.embedding).buffer);
      insert.run(doc.path, doc.content, embeddingBlob);
    }

    return {
      dbPath,
      docCount: docs.length,
      errors,
    };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true });
    const mdFiles: string[] = [];
    for (const entry of entries) {
      if (typeof entry !== 'string') continue;
      if (!entry.endsWith('.md')) continue;
      mdFiles.push(join(dir, entry));
    }
    return mdFiles;
  } catch {
    return [];
  }
}

/**
 * cosine 相似度（用于检索结果排序）
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}