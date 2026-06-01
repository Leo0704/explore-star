/**
 * RAG 检索器
 *
 * 从 sqlite-vec 索引中 top-K cosine 相似度检索。
 */
import Database from 'better-sqlite3';
import { cosineSimilarity } from './index-builder.js';
/**
 * 从已有 sqlite-vec 索引中检索 top-K 相关文档
 *
 * @param query       检索 query 文本
 * @param k           返回条数，默认 3
 * @param dbPath      sqlite-vec 数据库路径
 * @param embeddingProvider  向量模型（用于将 query 向量化）
 */
export async function retrieveTopK(query, k, dbPath, embeddingProvider) {
    const queryEmbedding = await embeddingProvider.embed(query);
    const db = new Database(dbPath);
    try {
        db.loadExtension('sqlite-vec');
        // 读取所有向量（V1 规模小，全量扫描足够）
        const rows = db.prepare('SELECT path, content, embedding FROM knowledge_vectors').all();
        if (rows.length === 0)
            return [];
        // 解码 embedding（BLOB → Float32Array → number[]）
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
    }
    finally {
        db.close();
    }
}
/**
 * 从内存缓存中检索（buildIndex 之后用）
 * V1 实现：内存扫描，无持久化检索路径
 */
const cachedDocs = new Map();
export function cacheDocs(knowledgeDir, docs) {
    cachedDocs.set(knowledgeDir, docs);
}
export async function retrieveFromCache(query, k, knowledgeDir, embeddingProvider) {
    const docs = cachedDocs.get(knowledgeDir);
    if (!docs || docs.length === 0)
        return [];
    const queryEmbedding = await embeddingProvider.embed(query);
    return docs
        .map(d => ({ path: d.path, content: d.content, score: cosineSimilarity(queryEmbedding, d.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
}
export function clearCache(knowledgeDir) {
    if (knowledgeDir) {
        cachedDocs.delete(knowledgeDir);
    }
    else {
        cachedDocs.clear();
    }
}
//# sourceMappingURL=retriever.js.map