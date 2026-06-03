import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const USAGE = `
用法:
  npx explore-star init <name>
  npx explore-star init <name> --source <source-dir>

示例:
  npx explore-star init my-business
  npx explore-star init my-business --source ./another-business.example

说明:
  复制 business.example/燃点-FDE/ 到新业务目录。
  复制后需要：
    1. 编辑 profile.yaml 改 business.name / value_prop / target_personas
    2. 设置环境变量：export DEEPSEEK_API_KEY=...
    3. 跑 npx explore-star doctor
`;

export async function runInit(args: string[]): Promise<void> {
  let name = '';
  let source = './business.example/燃点-FDE';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source' && i + 1 < args.length) {
      source = args[++i];
    } else if (!arg.startsWith('--')) {
      name = arg;
    }
  }

  if (!name) {
    console.log(USAGE);
    console.error('\n错误：缺少 <name> 参数');
    process.exit(1);
    return;
  }

  if (!existsSync(source)) {
    console.error(`错误：源目录不存在 ${source}`);
    process.exit(1);
    return;
  }

  const dst = `./${name}`;
  if (existsSync(dst)) {
    console.error(`错误：目标目录已存在 ${dst}`);
    process.exit(1);
    return;
  }

  console.log(`📋 初始化业务目录：${name}`);
  console.log(`   源：${source}`);
  console.log(`   目标：${dst}`);

  await copyDir(source, dst);

  console.log(`\n✅ 已复制到 ${dst}`);
  console.log(`\n下一步：`);
  console.log(`  1. 编辑 ${dst}/profile.yaml 改 business.name / value_prop / target_personas`);
  console.log(`  2. 可选：编辑 ${dst}/channels.yaml / conversion.yaml / crm.yaml`);
  console.log(`  3. 设置环境变量：export DEEPSEEK_API_KEY=...`);
  console.log(`  4. 跑 npx explore-star doctor`);
  console.log(`  5. 试跑：npx explore-star run --business=./${name} --dry-run`);
}

async function copyDir(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else {
      await writeFile(d, await readFile(s));
    }
  }
}

export async function runCLI(args: string[]): Promise<void> {
  await runInit(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}