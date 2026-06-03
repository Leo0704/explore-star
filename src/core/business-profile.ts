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

export async function loadBusinessProfile(businessDir: string): Promise<LoadedBusiness> {
  const profilePath = join(businessDir, 'profile.yaml');
  const channelsPath = join(businessDir, 'channels.yaml');
  const conversionPath = join(businessDir, 'conversion.yaml');

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

  let channels: ChannelsConfig;
  try {
    const raw = await readFile(channelsPath, 'utf-8');
    const parsed = yaml.parse(raw) ?? {};
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

  if (!conversion.lifecycle_states || conversion.lifecycle_states.length === 0) {
    throw new Error(`${conversionPath} 缺少 lifecycle_states`);
  }

  const promptsDir = profile.prompts_dir || join(businessDir, 'prompts');
  const knowledgeDir = profile.knowledge_dir || join(businessDir, 'knowledge');

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

async function mergeCrmYaml(businessDir: string, profile: BusinessProfile): Promise<void> {
  const crmPath = join(businessDir, 'crm.yaml');
  let crmRaw: string;
  try {
    crmRaw = await readFile(crmPath, 'utf-8');
  } catch {
    return;
  }

  let parsed: { crm?: { type?: string; config?: Record<string, unknown> } };
  try {
    parsed = yaml.parse(crmRaw) ?? {};
  } catch (e) {
    throw new Error(`crm.yaml 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }

  const crmBlock = parsed.crm;
  if (!crmBlock) return;

  if (crmBlock.type && crmBlock.type !== profile.crm.type) {
    throw new Error(
      `crm.yaml 与 profile.yaml 的 crm.type 冲突：crm.yaml=${crmBlock.type}, profile.yaml=${profile.crm.type}`,
    );
  }

  if (crmBlock.config) {
    for (const [k, v] of Object.entries(crmBlock.config)) {
      if (k === 'field_mapping' && v && typeof v === 'object') {
        (profile.crm as { field_mapping?: Record<string, string> }).field_mapping =
          v as Record<string, string>;
      } else {
        (profile.crm.config as Record<string, unknown>)[k] = v;
      }
    }
  }
}
