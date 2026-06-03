import Database, { type Database as DatabaseType } from 'better-sqlite3';
import type { EmbeddingProvider } from '../core/types.js';
import { cosineSimilarity } from './index-builder.js';

export interface RetrievedDoc {
  path: string;
  content: string;
  score: number;
}

export async function retrieveTopK(
  query: string,
  k: number,
  dbPath: string,
  embeddingProvider: EmbeddingProvider,
): Promise<RetrievedDoc[]> {
  const queryEmbedding = await embeddingProvider.embed(query);

  let db: DatabaseType;
  try {
    db = new Database(dbPath);
  } catch {
    return [];
  }
  try {
    db.loadExtension('sqlite-vec');

    const rows = db.prepare('SELECT path, content, embedding FROM knowledge_vectors').all() as Array<{
      path: string;
      content: string;
      embedding: Buffer;
    }>;

    if (rows.length === 0) return [];

    const scored = rows
      .map(row => {
        const emb = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
        const vec = Array.from(emb);
        return {
          path: row.path,
          content: row.content,
          score: cosineSimilarity(queryEmbedding, vec),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return scored;
  } finally {
    db.close();
  }
}

