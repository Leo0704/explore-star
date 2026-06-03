import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

interface ScheduleJob {
  name: string;
  cron: string;
  command: string;
  args?: string[];
}

interface ScheduleConfig {
  project_dir: string;
  jobs: ScheduleJob[];
}

const CRON_TAG = '# [explore-star]'
const SCHEDULE_FILE = 'schedule.yaml'

export async function runCLI(args: string[]) {
  const businessDir = extractFlag(args, '--business') ?? process.cwd()
  const action = detectAction(args)

  if (!action) {
    console.log(`
用法：
  explore-star schedule --install    安装定时任务到系统 crontab
  explore-star schedule --list       查看已安装的定时任务
  explore-star schedule --uninstall  卸载探星定时任务

选项：
  --business <dir>    业务目录（默认当前目录）
`)
    return
  }

  const schedulePath = join(businessDir, SCHEDULE_FILE)
  if (action !== 'list' && !existsSync(schedulePath)) {
    console.error(`找不到 ${schedulePath}`)
    console.error(`请先创建 ${SCHEDULE_FILE}，参考 SETUP.md`)
    process.exit(1)
  }

  switch (action) {
    case 'install':
      await install(schedulePath, businessDir)
      break
    case 'list':
      list()
      break
    case 'uninstall':
      uninstall()
      break
  }
}

// ── Install ─────────────────────────────────────────────────────────────────

async function install(schedulePath: string, businessDir: string) {
  const raw = readFileSync(schedulePath, 'utf-8')
  const config: { jobs: ScheduleJob[] } = parseYaml(raw)

  if (!config.jobs || config.jobs.length === 0) {
    console.error('schedule.yaml 中没有定义任何任务')
    process.exit(1)
  }

  const existingCrontab = getCrontab()
  const cleaned = removeExploreStarEntries(existingCrontab)

  const projectDir = businessDir
  const newEntries = config.jobs.map(job => {
    const args = job.args?.length ? ' ' + job.args.map(shellQuote).join(' ') : ''
    const cmd = `cd ${shellQuote(projectDir)} && npx explore-star ${job.command} --business=${shellQuote(projectDir)}${args}`
    return `${CRON_TAG} ${job.cron} ${cmd}  # ${job.name}`
  })

  const newCrontab = cleaned
    ? `${cleaned}\n${newEntries.join('\n')}\n`
    : `${newEntries.join('\n')}\n`

  writeCrontab(newCrontab)

  console.log(`✅ 已安装 ${config.jobs.length} 个定时任务：`)
  for (const job of config.jobs) {
    console.log(`   ${job.cron}  ${job.name} → explore-star ${job.command}`)
  }
  console.log(`\n查看系统 cron: crontab -l`)
  console.log(`卸载: npx explore-star schedule --uninstall`)
}

// ── List ────────────────────────────────────────────────────────────────────

function list() {
  const crontab = getCrontab()
  const entries = crontab
    .split('\n')
    .filter(line => line.includes(CRON_TAG))

  if (entries.length === 0) {
    console.log('未安装探星定时任务')
    console.log(`安装: npx explore-star schedule --install`)
    return
  }

  console.log(`已安装 ${entries.length} 个探星定时任务：\n`)
  for (const entry of entries) {
    const comment = entry.split('#').pop()?.trim() ?? ''
    console.log(`  ${entry}`)
  }
}

// ── Uninstall ───────────────────────────────────────────────────────────────

function uninstall() {
  const existingCrontab = getCrontab()
  const cleaned = removeExploreStarEntries(existingCrontab)

  const removedCount = existingCrontab
    .split('\n')
    .filter(line => line.includes(CRON_TAG)).length

  writeCrontab(cleaned)
  console.log(`✅ 已卸载 ${removedCount} 个探星定时任务`)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function detectAction(args: string[]): string | null {
  if (args.includes('--install')) return 'install'
  if (args.includes('--list')) return 'list'
  if (args.includes('--uninstall')) return 'uninstall'
  return null
}

function extractFlag(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag)
  if (idx === -1 || idx + 1 >= args.length) return null
  return args[idx + 1]
}

function getCrontab(): string {
  try {
    return execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
  } catch {
    return ''
  }
}

function writeCrontab(content: string) {
  execSync('crontab -', { input: content, encoding: 'utf-8' })
}

function removeExploreStarEntries(crontab: string): string {
  return crontab
    .split('\n')
    .filter(line => !line.includes(CRON_TAG))
    .join('\n')
    .trim()
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
