/**
 * Adapter 注册中心
 *
 * 探星支持 5 类 Adapter：
 *   - LLM:    OpenAI / DeepSeek / Anthropic / Ollama / 自定义
 *   - CRM:    飞书 / Notion / Airtable / CSV / 自定义
 *   - Channel: 抖音（V1）/ 小红书/B站（V2）/ 自定义
 *   - Notifier: 微信 / 飞书 / 邮件 / Slack / 自定义
 *   - Embeddings: OpenAI / 本地 bge / 自定义
 *
 * 注册流程：
 *   1. 启动时 `registerBuiltins()` 注册内置实现
 *   2. `loadUserAdapters(BUSINESS_DIR)` 加载 `business/adapters/<type>/*.ts`
 *      业务方自定义的同名 Adapter 会**覆盖**内置实现
 *   3. 业务代码通过 `getLLM(name)` / `getCRM(name)` 等工厂方法获取实例
 */
import type { LLMProvider, CRMAdapter, ChannelAdapter, Notifier, EmbeddingProvider } from '../core/types.js';
import type { BookingProvider } from './booking/base.js';
export declare function registerLLM(name: string, impl: LLMProvider): void;
export declare function getLLM(name: string): LLMProvider;
export declare function listLLMs(): string[];
export declare function registerCRM(name: string, impl: CRMAdapter): void;
export declare function getCRM(name: string): CRMAdapter;
export declare function listCRMs(): string[];
export declare function registerChannel(name: string, impl: ChannelAdapter): void;
export declare function getChannel(name: string): ChannelAdapter;
export declare function registerNotifier(name: string, impl: Notifier): void;
export declare function getNotifier(name: string): Notifier;
export declare function listNotifiers(): string[];
export declare function registerEmbedding(name: string, impl: EmbeddingProvider): void;
export declare function getEmbedding(name: string): EmbeddingProvider;
export declare function listEmbeddings(): string[];
export declare function registerBookingProvider(name: string, impl: BookingProvider): void;
export declare function getBookingProvider(name: string): BookingProvider;
export declare function listBookingProviders(): string[];
export declare function registerBuiltins(): Promise<void>;
export declare function healthCheckAll(): Promise<Record<string, {
    ok: boolean;
    detail?: string;
}>>;
