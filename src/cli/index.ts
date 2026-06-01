#!/usr/bin/env node
/**
 * 探星 CLI 入口
 *
 * 命令：
 *   explore-star init <name>           —— 复制 business.example 到新业务目录
 *   explore-star doctor                —— 检查环境
 *   explore-star run --business=<dir>  —— 跑主流程（§3.7 编排器）
 *   explore-star analyze --business=<dir>  —— 单跑意图分析
 *   explore-star nurture --business=<dir> —— 单跑引导引擎
 *   explore-star convert --business=<dir> —— 单跑转化引擎
 *   explore-star insights              —— 跑反馈分析器
 */

import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';

import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, listLLMs, listCRMs, listEmbeddings } from '../adapters/registry.js';

const USAGE = `
探星 CLI（Explore-Star v0.1.0）

命令：
  init <name>          复制 business.example/燃点-FDE/ 到 ./<name>/
  doctor               检查环境（opencli / API Key / 业务配置）
  run                  跑每日主流程（需 --business=<dir>）
  analyze              单跑意图分析
  nurture              单跑引导引擎
  convert              单跑转化引擎
  insights             跑反馈分析器
  search <keyword>     调 opencli douyin search
  build-rag-index      构建 RAG 索引

环境变量：
  DEEPSEEK_API_KEY     LLM API Key（推荐）
  OPENAI_API_KEY       备选
  FEISHU_APP_ID        飞书 CRM（可选）
  FEISHU_APP_SECRET    飞书 CRM（可选）
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return;
  }

  await registerBuiltins();

  switch (cmd) {
    case 'init':           return cmdInit(rest);
    case 'doctor':         return cmdDoctor(rest);
    case 'run':            return cmdRun(rest);
    case 'analyze':        return cmdAnalyze(rest);
    case 'nurture':        return cmdNurture(rest);
    case 'convert':        return cmdConvert(rest);
    case 'insights':       return cmdInsights(rest);
    case 'search':         return cmdSearch(rest);
    case 'build-rag-index': return cmdBuildRagIndex(rest);
    default:
      console.error(`未知命令: ${cmd}`);
      console.log(USAGE);
      process.exit(1);
  }
}

function getFlag(args: string[], flag: string): string | undefined {
  const eq = args.find(a => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// ---------------------------------------------------------------------------
// init: 复制业务示例
// ---------------------------------------------------------------------------

async function cmdInit(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) { console.error('用法: explore-star init <name>'); process.exit(1); }
  const src = './business.example/燃点-FDE';
  const dst = `./${name}`;
  if (!existsSync(src)) { console.error(`源 ${src} 不存在`); process.exit(1); }
  if (existsSync(dst)) { console.error(`目标 ${dst} 已存在`); process.exit(1); }
  await copyDir(src, dst);
  console.log(`✅ 已复制到 ${dst}`);
  console.log(`下一步：`);
  console.log(`  1. 编辑 ${dst}/profile.yaml 改 business.name / value_prop / target_personas`);
  console.log(`  2. 设置环境变量：export DEEPSEEK_API_KEY=...`);
  console.log(`  3. 跑 npx explore-star doctor`);
  console.log(`  4. 试跑：npx explore-star run --business=./${name} --dry-run`);
}

async function copyDir(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await writeFile(d, await readFile(s));
  }
}

// ---------------------------------------------------------------------------
// doctor: 环境检查
// ---------------------------------------------------------------------------

async function cmdDoctor(_args: string[]): Promise<void> {
  console.log('🔍 探星医生 v0.1.0\n');
  let pass = 0, warn = 0, fail = 0;

  // 1. Node 版本
  const nodeMajor = parseInt(process.versions.node.split('.')[0]);
  if (nodeMajor >= 20) { console.log('  ✅ Node', process.versions.node, '（≥20）'); pass++; }
  else { console.log('  ❌ Node', process.versions.node, '（需 ≥20）'); fail++; }

  // 2. opencli 可用
  try {
    const { execSync } = await import('node:child_process');
    const ver = execSync('opencli --version', { encoding: 'utf-8' }).trim();
    console.log('  ✅ opencli', ver); pass++;
  } catch {
    console.log('  ❌ opencli 不可用（请 `npm install -g @jackwener/opencli`）'); fail++;
  }

  // 3. LLM API Key
  if (process.env.DEEPSEEK_API_KEY) { console.log('  ✅ DEEPSEEK_API_KEY 已设置'); pass++; }
  else if (process.env.OPENAI_API_KEY) { console.log('  ✅ OPENAI_API_KEY 已设置'); pass++; }
  else { console.log('  ❌ 缺 LLM API Key（DEEPSEEK_API_KEY 或 OPENAI_API_KEY）'); fail++; }

  // 4. 业务配置
  const businessDir = './business.example/燃点-FDE';
  try {
    const loaded = await loadBusinessProfile(businessDir);
    console.log(`  ✅ 业务配置加载成功：${loaded.profile.business.name}`); pass++;
  } catch (e) {
    console.log(`  ❌ 业务配置加载失败：${e instanceof Error ? e.message : String(e)}`); fail++;
  }

  // 5. 已注册 adapter
  const llms = listLLMs();
  const crms = listCRMs();
  const embeds = listEmbeddings();
  if (llms.length > 0) { console.log(`  ✅ LLM：${llms.join(', ')}`); pass++; }
  else { console.log('  ⚠️ LLM 未注册（API Key 缺失）'); warn++; }
  console.log(`  ℹ️  CRM：${crms.join(', ')}`);
  if (embeds.length > 0) console.log(`  ✅ Embeddings：${embeds.join(', ')}`);
  else console.log('  ⚠️ Embeddings 未注册（RAG 检索不可用）');

  console.log(`\n汇总：${pass} 通过 / ${warn} 警告 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// run: 编排器
// ---------------------------------------------------------------------------

async function cmdRun(args: string[]): Promise<void> {
  const { runCLI } = await import('../orchestration/run-daily.js');
  await runCLI(['--business', getFlag(args, '--business') || './business.example/燃点-FDE', ...args]);
}

// ---------------------------------------------------------------------------
// analyze / nurture / convert / insights
// ---------------------------------------------------------------------------

async function cmdAnalyze(args: string[]): Promise<void> {
  const { runCLI } = await import('../modules/intent-analyzer/index.js');
  await runCLI(args);
}
async function cmdNurture(args: string[]): Promise<void> {
  const { runCLI } = await import('../modules/nurture-engine/index.js');
  await runCLI(args);
}
async function cmdConvert(args: string[]): Promise<void> {
  const { runCLI } = await import('../modules/conversion-engine/index.js');
  await runCLI(args);
}
async function cmdInsights(_args: string[]): Promise<void> {
  const { runCLI } = await import('../modules/feedback-analyzer/index.js');
  await runCLI([]);
}

async function cmdSearch(args: string[]): Promise<void> {
  const kw = args.join(' ');
  if (!kw) { console.error('用法: explore-star search <keyword>'); process.exit(1); }
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('opencli', ['douyin', 'search', kw, '--limit', '10', '--format', 'json'], { timeout: 60000 });
  console.log(stdout);
}

async function cmdBuildRagIndex(args: string[]): Promise<void> {
  const businessDir = getFlag(args, '--business') || './business.example/燃点-FDE';
  const loaded = await loadBusinessProfile(businessDir);
  const { buildIndex } = await import('../rag/index.js');
  const result = await buildIndex({ profile: loaded.profile, knowledgeDir: loaded.knowledgeDir, promptsDir: loaded.promptsDir });
  console.log(`✅ RAG 索引完成：${result.indexed} 个文档`);
}

main().catch(e => { console.error(e); process.exit(1); });
