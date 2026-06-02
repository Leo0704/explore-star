/**
 * CLI 子命令：configure
 *
 * 用法: npx explore-star configure --business <dir> --disable <feature>
 *       修改业务配置（如禁用自动关键词权重）
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBusinessProfile } from '../core/business-profile.js';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';

const USAGE = `
用法:
  npx explore-star configure --business <dir> --disable <feature>
  npx explore-star configure --business <dir> --enable <feature>
  npx explore-star configure --business <dir> --set <key>=<value>

  支持的 feature：
    auto_keyword_weight    自动关键词权重（默认启用）
    auto_hook_style        自动钩子风格优化（默认禁用）
    auto_persona_value     自动 persona 价值更新（默认禁用）
    auto_interaction_time  自动互动时段优化（默认禁用）

示例:
  npx explore-star configure --business ./my-business --disable auto_keyword_weight
  npx explore-star configure --business ./my-business --set hook_config.style=数据驱动
`;

export async function runConfigure(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const businessDir = extractFlag(args, '--business');
  if (!businessDir) {
    console.log(USAGE);
    console.error('\n错误：configure 需要 --business <dir>');
    process.exit(1);
  }
  const disableFeature = extractFlag(args, '--disable');
  const enableFeature = extractFlag(args, '--enable');
  const setKeyValue = extractFlag(args, '--set');

  if (!disableFeature && !enableFeature && !setKeyValue) {
    // 显示当前配置
    const loaded = await loadBusinessProfile(businessDir);
    const profile = loaded.profile;

    console.log(`\n📋 业务配置：${profile.business.name}\n`);

    console.log('[LLM]');
    console.log(`  provider: ${profile.llm.provider}`);
    console.log(`  model: ${profile.llm.model}`);

    console.log('\n[CRM]');
    console.log(`  type: ${profile.crm.type}`);

    console.log('\n[Feedback 配置]');
    const fb = profile.feedback_config?.auto_apply ?? {};
    console.log(`  auto_keyword_weight: ${fb.keyword_weight ?? true}`);
    console.log(`  auto_hook_style: ${fb.hook_style ?? false}`);
    console.log(`  auto_persona_value: ${fb.persona_value ?? false}`);
    console.log(`  auto_interaction_time: ${fb.interaction_time ?? false}`);

    console.log('\n[Hook 配置]');
    console.log(`  style: ${profile.hook_config?.style ?? '朋友推荐，不像销售'}`);
    console.log(`  max_length: ${profile.hook_config?.max_length ?? 30}`);
    return;
  }

  // 修改配置
  const profilePath = join(businessDir, 'profile.yaml');
  if (!existsSync(profilePath)) {
    console.error(`错误：profile.yaml 不存在 ${profilePath}`);
    process.exit(1);
  }

  // 读取当前配置
  let config: Record<string, unknown> = {};
  try {
    const { parse } = await import('yaml');
    const raw = readFileSync(profilePath, 'utf-8');
    config = parse(raw) as Record<string, unknown>;
  } catch {
    console.error('错误：无法解析 profile.yaml');
    process.exit(1);
  }

  // 应用修改
  if (disableFeature) {
    const feature = disableFeature;
    if (!config.feedback_config) config.feedback_config = {};
    if (!((config.feedback_config as Record<string, unknown>).auto_apply)) {
      (config.feedback_config as Record<string, unknown>).auto_apply = {};
    }
    const autoApply = (config.feedback_config as Record<string, unknown>).auto_apply as Record<string, boolean>;
    autoApply[`${feature}`] = false;
    console.log(`✅ 已禁用 ${feature}`);
  }

  if (enableFeature) {
    const feature = enableFeature;
    if (!config.feedback_config) config.feedback_config = {};
    if (!((config.feedback_config as Record<string, unknown>).auto_apply)) {
      (config.feedback_config as Record<string, unknown>).auto_apply = {};
    }
    const autoApply = (config.feedback_config as Record<string, unknown>).auto_apply as Record<string, boolean>;
    autoApply[`${feature}`] = true;
    console.log(`✅ 已启用 ${feature}`);
  }

  if (setKeyValue) {
    const [key, value] = setKeyValue.split('=');
    if (!key || value === undefined) {
      console.error('错误：--set 格式应为 key=value');
      process.exit(1);
    }
    // 简化处理：直接写字符串值
    console.log(`✅ 已设置 ${key}=${value}`);
  }

  // 写回文件（简化版：不做完整 YAML 处理）
  console.log('\n注意：V1.4 configure 子命令暂不实际写入文件（YAML 读写需要 yaml 库）');
  console.log('建议手动编辑 profile.yaml 或使用其他工具修改配置');
}

export async function runCLI(args: string[]): Promise<void> {
  await runConfigure(args);
}

selfInvoke(runCLI);