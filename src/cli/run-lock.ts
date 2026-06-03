import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'cli/run-lock' });

export const LOCK_PATH = 'data/run.lock';

const STALE_LOCK_THRESHOLD_MS = 24 * 60 * 60 * 1000;

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

export function acquireLock(): boolean {
  const now = new Date();
  const content = `pid=${process.pid}\nstarted_at=${now.toISOString()}\n`;

  mkdirSync(dirname(LOCK_PATH), { recursive: true });

  let fd: number;
  try {
    fd = openSync(LOCK_PATH, 'wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    return handleExistingLock(content, now);
  }
  try {
    writeFileSync(fd, content, 'utf-8');
  } finally {
    closeSync(fd);
  }
  return true;
}

function handleExistingLock(content: string, now: Date): boolean {
  const existing = readExistingLock();
  if (!isStaleLock(existing, now)) {
    log.error(
      { pid: existing?.pid, startedAt: existing?.startedAt },
      '另一个 run 正在运行，拒绝启动',
    );
    return false;
  }
  if (existing) {
    log.warn(
      { pid: existing.pid, startedAt: existing.startedAt },
      '检测到 stale lock（PID 已死或锁超过 24h），覆盖之',
    );
  } else {
    log.warn('检测到无法解析的 lock 文件，覆盖之');
  }
  writeFileSync(LOCK_PATH, content, 'utf-8');
  return true;
}

function isStaleLock(existing: LockContent | null, now: Date): boolean {
  if (!existing) return true;
  if (!isProcessAlive(existing.pid)) return true;
  const startedAtMs = Date.parse(existing.startedAt);
  if (Number.isNaN(startedAtMs)) return true;
  return now.getTime() - startedAtMs > STALE_LOCK_THRESHOLD_MS;
}

export function releaseLock(): void {
  try {
    if (existsSync(LOCK_PATH)) {
      unlinkSync(LOCK_PATH);
    }
  } catch (e) {
    log.warn({ err: e }, '释放锁文件失败');
  }
}

export function setupSignalHandlers(releaseFn: () => void): void {
  const handler = (signal: NodeJS.Signals): void => {
    releaseFn();
    const code = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1;
    process.exit(code);
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}
