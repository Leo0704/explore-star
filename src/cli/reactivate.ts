/**
 * CLI 子命令：reactivate
 *
 * 用法: npx explore-star reactivate --business <dir> [--cid <cid>]
 *       再激活沉默客户
 */

import { loadBusinessProfile } from '../core/business-profile.js';
import { registerBuiltins, getCRM } from '../adapters/registry.js';
import { reactivateLead as doReactivate, reactivateDormantPool, findDormantLeads } from '../modules/conversion-engine/index.js';

const USAGE = `
用法:
  npx explore-star reactivate --business <dir>
  npx explore-star reactivate --business <dir> --cid <comment_id>

选项:
  --business <dir>    业务目录
  --cid <id>          再激活指定 lead（省略则批量再激活沉默池）
  --dry-run           不实际发送，只显示目标客户
`;

export async function runReactivate(args: string[]): Promise<void> {
  const businessDir = extractFlag(args, '--business') || './business.example/燃点-FDE';
  const cid = extractFlag(args, '--cid');
  const dryRun = args.includes('--dry-run');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  await registerBuiltins();

  // 加载业务配置
  const loaded = await loadBusinessProfile(businessDir);
  const { profile, conversion } = loaded;

  // CRM
  const crm = getCRM();

  if (cid) {
    // 单个再激活
    const lead = await crm.getLead(cid);
    if (!lead) {
      console.error(`错误：找不到 lead ${cid}`);
      process.exit(1);
    }

    console.log(`[reactivate] 再激活单个：${lead.nickname}（${cid}）`);
    if (!dryRun) {
      const result = await doReactivate(lead, { crm, conversion, profile });
      console.log(`  结果：${result.success ? '✅ 成功' : '❌ 失败'} - ${result.reason}`);
    } else {
      console.log('  → dry-run 模式，跳过实际发送');
    }
  } else {
    // 批量再激活沉默池
    const dormant = await findDormantLeads({ crm, conversion });
    console.log(`[reactivate] 沉默池：${dormant.length} 个客户待再激活`);

    if (dormant.length === 0) {
      console.log('  （无沉默客户）');
      return;
    }

    for (const lead of dormant) {
      const lastDays = lead.last_interaction_at
        ? Math.round((Date.now() - new Date(lead.last_interaction_at).getTime()) / 86400000)
        : '?';
      console.log(`  - @${lead.nickname}（${lastDays} 天无互动）`);
    }

    if (!dryRun) {
      const results = await reactivateDormantPool({ crm, conversion });
      console.log(`\n再激活结果：${results.filter(r => r.success).length}/${results.length} 成功`);
      for (const r of results) {
        console.log(`  ${r.success ? '✅' : '❌'} ${r.nickname}: ${r.reason}`);
      }
    } else {
      console.log('\n→ dry-run 模式，跳过实际发送');
    }
  }
}

function extractFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export async function runCLI(args: string[]): Promise<void> {
  await runReactivate(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}