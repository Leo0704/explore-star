/**
 * RAG 模块（§3.4）
 *
 * 从 ./index-builder.ts / ./retriever.ts / ./hook-generator.ts 重新导出。
 * 保留原有接口的向后兼容。
 */

// 索引构建
export { buildKnowledgeIndex, type IndexResult } from './index-builder.js';

// 检索
export { retrieveTopK, cacheDocs, retrieveFromCache, clearCache, type RetrievedDoc } from './retriever.js';

// 钩子生成
export { generateHook, type HookGeneratorOptions, type GenerateHookResult } from './hook-generator.js';