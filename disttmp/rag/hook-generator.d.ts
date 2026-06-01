/**
 * RAG 钩子生成器
 *
 * 业务方钩子生成：知识库检索 + 反馈驱动风格选择 + lead.hook_style 写入
 *
 * 关键设计（§3.4）：
 *   - 先尝试读取 data/feedback/weekly-insights.json，取最优 hook_style
 *   - 冷启动 fallback: profile.hook_config.style ?? '像朋友推荐，不像销售'
 *   - 必须写回 lead.hook_style
 */
import type { BusinessProfile, Lead, EmbeddingProvider } from '../core/types.js';
import { type RetrievedDoc } from './retriever.js';
export interface HookGeneratorOptions {
    profile: BusinessProfile;
    promptsDir: string;
    knowledgeDir: string;
    dbPath: string;
    embeddingProvider: EmbeddingProvider;
    topK?: number;
}
export interface GenerateHookResult {
    hook: string;
    hookStyle: string;
    usedDocs: RetrievedDoc[];
}
/**
 * 生成钩子话术
 *
 * @param profile      业务画像
 * @param lead         目标 lead
 * @param hookType     'reply'（评论回复）或 'dm'（私信）
 * @param opts         生成选项
 */
export declare function generateHook(profile: BusinessProfile, lead: Lead, hookType: 'reply' | 'dm', opts: HookGeneratorOptions): Promise<GenerateHookResult>;
