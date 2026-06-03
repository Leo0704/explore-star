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

import type {
  BusinessProfile, ChannelsConfig, ConversionConfig,
} from './types.js';
import { businessProfileSchema, formatZodError, ChannelRateLimitsSchema } from './config-schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LoadedBusiness {
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
 * 校验（启动时 fail-fast）：见 src/core/config-schemas.ts 的 businessProfileSchema
 *   - business.name / value_prop 非空
 *   - target_personas 至少 1 个
 *   - intent_signals 至少 1 个
 *   - llm.provider / llm.model / llm.api_key_env 必填
 *   - crm.type 必填
 */
export async function loadBusinessProfile(businessDir: string): Promise<LoadedBusiness> {
  const profilePath = join(businessDir, 'profile.yaml');
  const channelsPath = join(businessDir, 'channels.yaml');
  const conversionPath = join(businessDir, 'conversion.yaml');

  // profile.yaml 必须存在；channels / conversion 可选（有默认值）
  let profileRaw: unknown;
  try {
    const raw = await readFile(profilePath, 'utf-8');
    profileRaw = yaml.parse(raw);
  } catch (e) {
    throw new Error(`加载 ${profilePath} 失败：${e instanceof Error ? e.message : String(e)}`);
  }

  const result = businessProfileSchema.safeParse(profileRaw);
  if (!result.success) {
    throw new Error(`profile.yaml validation failed: ${formatZodError(profilePath, result.error)}`);
  }
  const profile = result.data as BusinessProfile;

  // channels.yaml —— 不存在则给默认（sec_uid 模式，空 sec_uids）
  let channels: ChannelsConfig;
  try {
    const raw = await readFile(channelsPath, 'utf-8');
    const parsed = yaml.parse(raw) ?? {};
    // Phase 1 #2：channel_rate_limits 启动时 zod 校验（配错 fail-fast，**不**静默默认）
    if (parsed.channel_rate_limits) {
      const rlResult = ChannelRateLimitsSchema.safeParse(parsed.channel_rate_limits);
      if (!rlResult.success) {
        throw new Error(formatZodError(channelsPath, rlResult.error));
      }
      parsed.channel_rate_limits = rlResult.data;
    }
    channels = parsed;
  } catch (e) {
    if (e instanceof Error && e.message.includes('校验失败')) throw e;
    channels = { source: { mode: 'sec_uid' } };
  }

  // conversion.yaml —— 不存在则给默认（只含新发现 / 已流失两个状态）
  let conversion: ConversionConfig;
  try {
    const raw = await readFile(conversionPath, 'utf-8');
    conversion = yaml.parse(raw) ?? {};
  } catch {
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

  // P0-J 修复：加载 crm.yaml（field_mapping / persona_options / status_options）
  // 业务方过去改 crm.yaml 实际不生效，原因是没人读它。现在 merge 进 profile.crm。
  await mergeCrmYaml(businessDir, profile);

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
 * 加载 crm.yaml（如果存在），把其字段合并进 profile.crm。
 *
 * 设计：
 *   - crm.yaml 是 crm 专属配置文件（field_mapping / persona_options / status_options 等）
 *   - profile.yaml 里 crm.type / crm.config.app_id_env 等基础字段也保留
 *   - crm.yaml 不存在时静默跳过（crm 配置完全来自 profile.yaml）
 *
 * 冲突处理：crm.yaml 与 profile.yaml 都有 crm.type 时，必须一致，否则抛错。
 */
async function mergeCrmYaml(businessDir: string, profile: BusinessProfile): Promise<void> {
  const crmPath = join(businessDir, 'crm.yaml');
  let crmRaw: string;
  try {
    crmRaw = await readFile(crmPath, 'utf-8');
  } catch {
    return; // crm.yaml 可选
  }

  let parsed: { crm?: { type?: string; config?: Record<string, unknown> } };
  try {
    parsed = yaml.parse(crmRaw) ?? {};
  } catch (e) {
    throw new Error(`crm.yaml 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }

  const crmBlock = parsed.crm;
  if (!crmBlock) return;

  // 冲突检测：crm.type 必须与 profile.yaml 一致
  if (crmBlock.type && crmBlock.type !== profile.crm.type) {
    throw new Error(
      `crm.yaml 与 profile.yaml 的 crm.type 冲突：crm.yaml=${crmBlock.type}, profile.yaml=${profile.crm.type}`,
    );
  }

  // 把 crm.config 里的字段合并进 profile.crm.config
  if (crmBlock.config) {
    for (const [k, v] of Object.entries(crmBlock.config)) {
      // field_mapping 提到顶层（与 CRMConfig 类型一致）
      if (k === 'field_mapping' && v && typeof v === 'object') {
        (profile.crm as { field_mapping?: Record<string, string> }).field_mapping =
          v as Record<string, string>;
      } else {
        (profile.crm.config as Record<string, unknown>)[k] = v;
      }
    }
  }
}
