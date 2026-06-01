/**
 * RAG 索引构建器
 *
 * 扫描 business.example/燃点-FDE/knowledge/ 下的 .md 文件，
 * 整文件向量化，入 sqlite-vec 索引库（data/vectors.db）。
 */
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
export declare function buildKnowledgeIndex(businessDir: string, embeddingProvider: EmbeddingProvider, dbPath?: string): Promise<IndexResult>;
/**
 * cosine 相似度（用于检索结果排序）
 */
export declare function cosineSimilarity(a: number[], b: number[]): number;
