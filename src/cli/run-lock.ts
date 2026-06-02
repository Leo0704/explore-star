/**
 * `run` 子命令的粗粒度进程锁。
 *
 * 设计：写一个 `data/run.lock` 文件，内容是
 *   pid={pid}\nstarted_at={iso}\n
 *
 * 启动流程：
 *   1. 锁文件不存在 → 直接写
 *   2. 存在 → 读 PID，用 `process.kill(pid, 0)` 检测
 *      - 还活着 → 拒绝（返回 false）
 *      - 已死（stale）→ 警告并覆盖
 *
 * 释放：正常退出 / SIGINT / SIGTERM 都通过 `releaseLock` 删文件。
 *
 * 不引入 proper-lockfile —— 那是给 state.json 这种业务文件用的，CLI
 * 入口锁只需要「同机器不并发跑两次」这一条语义，PID 文件足够。
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'cli/run-lock' });

export const LOCK_PATH = 'data/run.lock';

interface LockContent {
  pid: number;
  startedAt: string;
}

function parseLock(raw: string): LockContent | null {
  const pidMatch = raw.match(/^pid=(\d+)\s*$/m);
  if (!pidMatch) return null;
  const startedAtMatch = raw.match(/^started_at=(.*?)\s*$/m);
  return {
    pid: parseInt(pidMatch[1], 10),
    startedAt: startedAtMatch?.[1] ?? '',
  };
}

function readExistingLock(): LockContent | null {
  if (!existsSync(LOCK_PATH)) return null;
  try {
    return parseLock(readFileSync(LOCK_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 用 `process.kill(pid, 0)` 检测 PID 是否还活着（不发信号，只检测）。
 * - ESRCH（无此进程）→ false
 * - EPERM（存在但无权限发信号）→ true（别去踩别人家的锁）
 * - 其它异常 → false
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

/**
 * 同步写锁。成功返回 true；发现活锁返回 false（不写文件）。
 * stale 锁会被覆盖（带警告）。
 */
export function acquireLock(): boolean {
  const existing = readExistingLock();
  if (existing) {
    if (isProcessAlive(existing.pid)) {
      log.error({ pid: existing.pid, startedAt: existing.startedAt }, '另一个 run 正在运行，拒绝启动');
      return false;
    }
    log.warn({ pid: existing.pid }, '检测到 stale lock，覆盖之');
  }

  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  const content = `pid=${process.pid}\nstarted_at=${new Date().toISOString()}\n`;
  writeFileSync(LOCK_PATH, content, 'utf-8');
  return true;
}

/**
 * 同步删锁。文件不存在 / 删失败都不抛（释放阶段的错误不该阻塞退出）。
 */
export function releaseLock(): void {
  try {
    if (existsSync(LOCK_PATH)) {
      unlinkSync(LOCK_PATH);
    }
  } catch (e) {
    log.warn({ err: e }, '释放锁文件失败');
  }
}

/**
 * 注册 SIGINT / SIGTERM 处理器：先释放锁，再以约定退出码退出
 * （128 + 信号号，SIGINT→130、SIGTERM→143）。
 */
export function setupSignalHandlers(releaseFn: () => void): void {
  const handler = (signal: NodeJS.Signals): void => {
    releaseFn();
    const code = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1;
    process.exit(code);
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}
