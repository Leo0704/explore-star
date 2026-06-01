/**
 * RAG 检索器
 *
 * 从 sqlite-vec 索引中 top-K cosine 相似度检索。
 */
import type { EmbeddingProvider } from '../core/types.js';
export interface RetrievedDoc {
    path: string;
    content: string;
    score: number;
}
/**
 * 从已有 sqlite-vec 索引中检索 top-K 相关文档
 *
 * @param query       检索 query 文本
 * @param k           返回条数，默认 3
 * @param dbPath      sqlite-vec 数据库路径
 * @param embeddingProvider  向量模型（用于将 query 向量化）
 */
export declare function retrieveTopK(query: string, k: number, dbPath: string, embeddingProvider: EmbeddingProvider): Promise<RetrievedDoc[]>;
export declare function cacheDocs(knowledgeDir: string, docs: Array<{
    path: string;
    content: string;
    embedding: number[];
}>): void;
export declare function retrieveFromCache(query: string, k: number, knowledgeDir: string, embeddingProvider: EmbeddingProvider): Promise<RetrievedDoc[]>;
export declare function clearCache(knowledgeDir?: string): void;
