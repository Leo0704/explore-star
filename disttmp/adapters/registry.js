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
// 6 个 Map 维护实例池（按 name 索引）
const llmRegistry = new Map();
const crmRegistry = new Map();
const channelRegistry = new Map();
const notifierRegistry = new Map();
const embeddingRegistry = new Map();
const bookingRegistry = new Map();
// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------
export function registerLLM(name, impl) {
    if (llmRegistry.has(name)) {
        console.warn(`[adapters] LLM "${name}" 重复注册，将覆盖`);
    }
    llmRegistry.set(name, impl);
}
export function getLLM(name) {
    const impl = llmRegistry.get(name);
    if (!impl) {
        throw new Error(`LLM adapter "${name}" 未注册。可用：${[...llmRegistry.keys()].join(', ')}`);
    }
    return impl;
}
export function listLLMs() {
    return [...llmRegistry.keys()];
}
// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------
export function registerCRM(name, impl) {
    if (crmRegistry.has(name)) {
        console.warn(`[adapters] CRM "${name}" 重复注册，将覆盖`);
    }
    crmRegistry.set(name, impl);
}
export function getCRM(name) {
    const impl = crmRegistry.get(name);
    if (!impl) {
        throw new Error(`CRM adapter "${name}" 未注册。可用：${[...crmRegistry.keys()].join(', ')}`);
    }
    return impl;
}
export function listCRMs() {
    return [...crmRegistry.keys()];
}
// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------
export function registerChannel(name, impl) {
    channelRegistry.set(name, impl);
}
export function getChannel(name) {
    const impl = channelRegistry.get(name);
    if (!impl) {
        throw new Error(`Channel adapter "${name}" 未注册。可用：${[...channelRegistry.keys()].join(', ')}`);
    }
    return impl;
}
// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------
export function registerNotifier(name, impl) {
    notifierRegistry.set(name, impl);
}
export function getNotifier(name) {
    const impl = notifierRegistry.get(name);
    if (!impl) {
        throw new Error(`Notifier adapter "${name}" 未注册。可用：${[...notifierRegistry.keys()].join(', ')}`);
    }
    return impl;
}
export function listNotifiers() {
    return [...notifierRegistry.keys()];
}
// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------
export function registerEmbedding(name, impl) {
    embeddingRegistry.set(name, impl);
}
export function getEmbedding(name) {
    const impl = embeddingRegistry.get(name);
    if (!impl) {
        throw new Error(`Embedding adapter "${name}" 未注册。可用：${[...embeddingRegistry.keys()].join(', ')}`);
    }
    return impl;
}
export function listEmbeddings() {
    return [...embeddingRegistry.keys()];
}
// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------
export function registerBookingProvider(name, impl) {
    bookingRegistry.set(name, impl);
}
export function getBookingProvider(name) {
    const impl = bookingRegistry.get(name);
    if (!impl) {
        throw new Error(`Booking provider "${name}" 未注册。可用：${[...bookingRegistry.keys()].join(', ')}`);
    }
    return impl;
}
export function listBookingProviders() {
    return [...bookingRegistry.keys()];
}
// ---------------------------------------------------------------------------
// 内置注册（V1.4 阶段：只注册 stub + douyin；具体实现在 Day 2-9 补全）
// ---------------------------------------------------------------------------
export async function registerBuiltins() {
    // 动态 import 避免循环依赖
    const llm = await import('./llm/index.js');
    const crm = await import('./crm/index.js');
    const channel = await import('./channel/index.js');
    const notifier = await import('./notifier/index.js');
    const embedding = await import('./embeddings/index.js');
    const booking = await import('./booking/index.js');
    llm.registerAll?.();
    crm.registerAll?.();
    channel.registerAll?.();
    notifier.registerAll?.();
    embedding.registerAll?.();
    booking.registerAll?.();
}
// ---------------------------------------------------------------------------
// 健康检查
// ---------------------------------------------------------------------------
export async function healthCheckAll() {
    const results = {};
    for (const [name, llm] of llmRegistry.entries()) {
        try {
            const r = await llm.ping();
            results[`llm:${name}`] = { ok: r.ok, detail: `latency=${r.latency_ms}ms` };
        }
        catch (e) {
            results[`llm:${name}`] = { ok: false, detail: String(e) };
        }
    }
    for (const [name, crm] of crmRegistry.entries()) {
        try {
            const ok = await crm.ping();
            results[`crm:${name}`] = { ok };
        }
        catch (e) {
            results[`crm:${name}`] = { ok: false, detail: String(e) };
        }
    }
    for (const [name, ch] of channelRegistry.entries()) {
        try {
            const r = await ch.ping();
            results[`channel:${name}`] = { ok: r.ok, detail: r.loggedIn ? 'logged in' : 'not logged in' };
        }
        catch (e) {
            results[`channel:${name}`] = { ok: false, detail: String(e) };
        }
    }
    for (const [name, bp] of bookingRegistry.entries()) {
        try {
            const ok = await bp.ping();
            results[`booking:${name}`] = { ok };
        }
        catch (e) {
            results[`booking:${name}`] = { ok: false, detail: String(e) };
        }
    }
    return results;
}
//# sourceMappingURL=registry.js.map