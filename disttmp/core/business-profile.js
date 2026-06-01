/**
 * BusinessProfile 加载与校验
 *
 * 对应文档 §2.3 + §2.4 + §5.7
 *
 * 用法：
 *   const profile = await loadBusinessProfile('./business.example/燃点-FDE');
 *   console.log(profile.business.name);
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
const __dirname = dirname(fileURLToPath(import.meta.url));
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
export async function loadBusinessProfile(businessDir) {
    const profilePath = join(businessDir, 'profile.yaml');
    const channelsPath = join(businessDir, 'channels.yaml');
    const conversionPath = join(businessDir, 'conversion.yaml');
    // profile.yaml 必须存在；channels / conversion 可选（有默认值）
    let profile;
    try {
        const raw = await readFile(profilePath, 'utf-8');
        profile = yaml.parse(raw);
    }
    catch (e) {
        throw new Error(`加载 ${profilePath} 失败：${e instanceof Error ? e.message : String(e)}`);
    }
    validateProfile(profile);
    // channels.yaml —— 不存在则给默认（sec_uid 模式，空 sec_uids）
    let channels;
    try {
        const raw = await readFile(channelsPath, 'utf-8');
        channels = yaml.parse(raw) ?? {};
    }
    catch {
        channels = { source: { mode: 'sec_uid' } };
    }
    // conversion.yaml —— 不存在则给默认（只含新发现 / 已流失两个状态）
    let conversion;
    try {
        const raw = await readFile(conversionPath, 'utf-8');
        conversion = yaml.parse(raw) ?? {};
    }
    catch {
        conversion = {
            lifecycle_states: [
                { id: 'discovered', name: '新发现', is_terminal: false },
                { id: 'lost', name: '已流失', is_terminal: true },
            ],
            success_states: [],
        };
    }
    // 校验 conversion
    if (!conversion.lifecycle_states || conversion.lifecycle_states.length === 0) {
        throw new Error(`${conversionPath} 缺少 lifecycle_states`);
    }
    // 默认 prompts / knowledge 目录
    const promptsDir = profile.prompts_dir || join(businessDir, 'prompts');
    const knowledgeDir = profile.knowledge_dir || join(businessDir, 'knowledge');
    return {
        businessDir,
        profile,
        channels,
        conversion,
        promptsDir,
        knowledgeDir,
    };
}
/**
 * 校验 BusinessProfile 必填字段
 */
function validateProfile(p) {
    const required = [
        ['business.name', p.business?.name],
        ['business.value_prop', p.business?.value_prop],
        ['target_personas', p.target_personas],
        ['llm.provider', p.llm?.provider],
        ['llm.model', p.llm?.model],
        ['llm.api_key_env', p.llm?.api_key_env],
        ['crm.type', p.crm?.type],
    ];
    for (const [field, value] of required) {
        if (value === undefined || value === null || value === '') {
            throw new Error(`BusinessProfile 缺少必填字段: ${field}`);
        }
    }
    if (!Array.isArray(p.target_personas) || p.target_personas.length === 0) {
        throw new Error('target_personas 至少要 1 个');
    }
    if (!p.intent_signals || p.intent_signals.length === 0) {
        throw new Error('intent_signals 至少要 1 个信号词（供意图分析 prompt）');
    }
}
/**
 * 列出指定业务目录下的所有知识库 markdown 文件
 */
export async function listKnowledgeFiles(knowledgeDir) {
    try {
        const entries = await readdir(knowledgeDir, { recursive: true });
        return entries
            .filter((f) => typeof f === 'string' && f.endsWith('.md'))
            .map(f => join(knowledgeDir, f));
    }
    catch {
        return [];
    }
}
/**
 * 列出指定业务目录下的所有 prompt 模板文件
 */
export async function listPromptTemplates(promptsDir) {
    try {
        const entries = await readdir(promptsDir, { recursive: true });
        return entries
            .filter((f) => typeof f === 'string' && f.endsWith('.md'))
            .map(f => join(promptsDir, f));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=business-profile.js.map