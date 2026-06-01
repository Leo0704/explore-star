/**
 * BusinessProfile 加载与校验
 *
 * 对应文档 §2.3 + §2.4 + §5.7
 *
 * 用法：
 *   const profile = await loadBusinessProfile('./business.example/燃点-FDE');
 *   console.log(profile.business.name);
 */
import type { BusinessProfile, ChannelsConfig, ConversionConfig } from './types.js';
export interface LoadedBusiness {
    businessDir: string;
    profile: BusinessProfile;
    channels: ChannelsConfig;
    conversion: ConversionConfig;
    promptsDir: string;
    knowledgeDir: string;
}
/**
 * 加载一个完整业务配置
 *
 * 必读文件：
 *   - profile.yaml      → BusinessProfile
 *   - channels.yaml     → ChannelsConfig（V1.4 起，target_sec_uids 在此）
 *   - conversion.yaml   → ConversionConfig
 *
 * 校验规则（按 §2.3 MVP）：
 *   - business.name 非空
 *   - business.value_prop 非空
 *   - target_personas 至少 1 个
 *   - llm.provider / llm.model / llm.api_key_env 必填
 *   - crm.type 必填
 */
export declare function loadBusinessProfile(businessDir: string): Promise<LoadedBusiness>;
/**
 * 列出指定业务目录下的所有知识库 markdown 文件
 */
export declare function listKnowledgeFiles(knowledgeDir: string): Promise<string[]>;
/**
 * 列出指定业务目录下的所有 prompt 模板文件
 */
export declare function listPromptTemplates(promptsDir: string): Promise<string[]>;
