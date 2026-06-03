import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, listLLMs, listCRMs, listEmbeddings } from '../adapters/registry.js';
import { checkAll, formatHealthReport, type HealthCheckResult } from '../orchestration/health-check.js';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';

const USAGE = `
用法:
  npx explore-star doctor --business <dir>

说明:
  检查环境配置，包括：
    1. Node 版本
    2. opencli 可用性
    3. LLM API Key
    4. 业务配置
    5. Adapter 注册状态
    6. 紧急停止开关
    7. 限速状态
`;

export async function runDoctor(args: string[]): Promise<void> {
  const businessDir = extractFlag(args, '--business');
  if (!businessDir) {
    console.log(USAGE);
    console.error('\n错误：doctor 需要 --business <dir>');
    process.exit(1);
  }

  console.log('🔍 探星医生 v0.1.0\n');
  let pass = 0, warn = 0, fail = 0;

  const nodeMajor = parseInt(process.versions.node.split('.')[0]);
  if (nodeMajor >= 20) {
    console.log('  ✅ Node', process.versions.node, '（≥20）');
    pass++;
  } else {
    console.log('  ❌ Node', process.versions.node, '（需 ≥20）');
    fail++;
  }

  try {
    const ver = execSync('opencli --version', { encoding: 'utf-8', timeout: 10000 }).trim();
    console.log('  ✅ opencli', ver);
    pass++;
  } catch {
    console.log('  ⚠️  opencli 不可用（`npm install -g @jackwener/opencli`）');
    warn++;
  }

  if (process.env.DEEPSEEK_API_KEY) {
    console.log('  ✅ DEEPSEEK_API_KEY 已设置');
    pass++;
  } else if (process.env.OPENAI_API_KEY) {
    console.log('  ✅ OPENAI_API_KEY 已设置');
    pass++;
  } else if (process.env.ANTHROPIC_API_KEY) {
    console.log('  ✅ ANTHROPIC_API_KEY 已设置');
    pass++;
  } else if (process.env.OLLAMA_BASE_URL) {
    console.log('  ✅ OLLAMA_BASE_URL 已设置（本地 LLM）');
    pass++;
  } else {
    console.log('  ❌ 缺 LLM API Key（DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OLLAMA_BASE_URL 之一）');
    fail++;
  }

  try {
    await registerBuiltins();
    const loaded = await loadBusinessProfile(businessDir);
    console.log(`  ✅ 业务配置加载成功：${loaded.profile.business.name}`);
    pass++;
  } catch (e) {
    console.log(`  ❌ 业务配置加载失败：${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }

  const llms = listLLMs();
  const crms = listCRMs();
  const embeds = listEmbeddings();
  if (llms.length > 0) {
    console.log(`  ✅ LLM：${llms.join(', ')}`);
    pass++;
  } else {
    console.log('  ⚠️  LLM 未注册（API Key 缺失）');
    warn++;
  }
  console.log(`  ℹ️  CRM：${crms.join(', ') || '(未配置)'}`);
  if (embeds.length > 0) {
    console.log(`  ✅ Embeddings：${embeds.join(', ')}`);
    pass++;
  } else {
    console.log('  ⚠️  Embeddings 未注册（RAG 检索不可用）');
    warn++;
  }

  const stopPath = businessDir ? join(businessDir, 'config', 'EMERGENCY_STOP') : './config/EMERGENCY_STOP';
  if (existsSync(stopPath)) {
    console.log(`  ❌ 紧急停止开关已启用（${stopPath}）`);
    fail++;
  } else {
    console.log('  ✅ 紧急停止开关未启用');
    pass++;
  }

  try {
    const health = await checkAll(businessDir);
    console.log('\n' + formatHealthReport(health));
    if (health.status === 'critical') fail++;
    else if (health.status === 'warning') warn++;
    else pass++;
  } catch (e) {
    console.log(`  ⚠️  健康检查失败：${e instanceof Error ? e.message : String(e)}`);
    warn++;
  }

  console.log(`\n汇总：${pass} 通过 / ${warn} 警告 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

export async function runCLI(args: string[]): Promise<void> {
  await runDoctor(args);
}

selfInvoke(import.meta.url, runCLI);