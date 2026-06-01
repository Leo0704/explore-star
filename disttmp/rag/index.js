/**
 * RAG 模块（§3.4）
 *
 * 从 ./index-builder.ts / ./retriever.ts / ./hook-generator.ts 重新导出。
 * 保留原有接口的向后兼容。
 */
// 索引构建
export { buildKnowledgeIndex } from './index-builder.js';
// 检索
export { retrieveTopK, cacheDocs, retrieveFromCache, clearCache } from './retriever.js';
// 钩子生成
export { generateHook } from './hook-generator.js';
//# sourceMappingURL=index.js.map