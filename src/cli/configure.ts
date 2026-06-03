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

  const profilePath = join(businessDir, 'profile.yaml');
  if (!existsSync(profilePath)) {
    console.error(`错误：profile.yaml 不存在 ${profilePath}`);
    process.exit(1);
  }

  let doc: import('yaml').Document.Parsed;
  try {
    const { parseDocument } = await import('yaml');
    const raw = readFileSync(profilePath, 'utf-8');
    doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      console.error('错误：profile.yaml 解析有问题', doc.errors[0]?.message);
      process.exit(1);
    }
  } catch {
    console.error('错误：无法解析 profile.yaml');
    process.exit(1);
  }

  if (disableFeature) {
    doc.setIn(['feedback_config', 'auto_apply', disableFeature], false);
    console.log(`✅ 已禁用 ${disableFeature}`);
  }

  if (enableFeature) {
    doc.setIn(['feedback_config', 'auto_apply', enableFeature], true);
    console.log(`✅ 已启用 ${enableFeature}`);
  }

  if (setKeyValue) {
    const [key, value] = setKeyValue.split('=');
    if (!key || value === undefined) {
      console.error('错误：--set 格式应为 key=value');
      process.exit(1);
    }
    // 自动类型转换：true / false → 布尔，数字字面量 → 数字，其余按字符串
    let parsed: unknown = value;
    if (value === 'true') parsed = true;
    else if (value === 'false') parsed = false;
    else if (/^-?\d+(?:\.\d+)?$/.test(value)) parsed = Number(value);
    doc.setIn(key.split('.'), parsed);
    console.log(`✅ 已设置 ${key}=${value}`);
  }

  writeFileSync(profilePath, doc.toString(), 'utf-8');
  console.log(`\n✅ 已写入 ${profilePath}`);
}

export async function runCLI(args: string[]): Promise<void> {
  await runConfigure(args);
}

selfInvoke(import.meta.url, runCLI);