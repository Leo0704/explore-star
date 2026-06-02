/**
 * 状态管理（断点续传 data/state.json）
 *
 * V1.4 实现：
 *   - loadState / saveState: 读写断点状态
 *   - updateStep: 更新当前步骤
 *   - markComplete: 标记步骤完成
 *   - getResumePoint: 获取恢复点
 *
 * Y3 并发安全：
 *   - 用 proper-lockfile 给 data/state.json 加进程间互斥锁
 *   - 锁文件位于 data/.state.json.lock（不与 state.json 同名避免污染备份）
 *   - 30 秒内获取不到锁直接抛错，不做指数退避
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import lockfile from 'proper-lockfile';

export interface PipelineState {
  date: string;
  currentStep: number;       // 0-6，对应 7 步
  steps: StepState[];
  startedAt: string;          // ISO 8601
  lastUpdatedAt: string;      // ISO 8601
  errors: string[];
  completed: boolean;
}

export interface StepState {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

const STATE_FILE = './data/state.json';
const LOCK_FILE = './data/.state.json.lock';
const LOCK_TIMEOUT_MS = 30_000;

const STEP_NAMES = [
  'reconnaissance',   // 侦察
  'analysis',         // 分析
  'sync',             // 同步
  'task_generation',  // 任务生成
  'execution',        // 执行
  'notification',     // 通知
  'health_check',     // 健康检查
];

/**
 * 加锁执行 load-modify-save。fn 收到当前 state，可原地修改后返回（返回 partial
 * 会被浅合并）。30 秒内拿不到锁直接抛错。
 */
export async function withStateLock(
  fn: (state: PipelineState) => Promise<Partial<PipelineState>>,
): Promise<PipelineState> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  if (!existsSync(STATE_FILE)) {
    // proper-lockfile 要求目标文件存在，先落一个空 state
    await writeFile(STATE_FILE, JSON.stringify(createEmptyState(), null, 2), 'utf-8');
  }

  let release: () => Promise<void>;
  try {
    // 30 秒总超时：300 retries × 100ms 固定间隔（无指数退避，简单）
    release = await lockfile.lock(STATE_FILE, {
      lockfilePath: LOCK_FILE,
      realpath: false,
      retries: { retries: 300, factor: 1, minTimeout: 100, maxTimeout: 100 },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to acquire state lock after ${LOCK_TIMEOUT_MS}ms: ${reason}`);
  }

  try {
    const state = await loadStateUnlocked();
    const patch = await fn(state);
    const merged: PipelineState = { ...state, ...patch };
    await saveStateUnlocked(merged);
    return merged;
  } finally {
    try {
      await release();
    } catch {
      // 解锁失败不影响业务结果
    }
  }
}

/**
 * 加载状态（如果不存在则返回空白）。
 *
 * 不加锁：原子 rename 写入保证读到一致快照；上层如需 load-modify-save
 * 请用 withStateLock。
 */
export async function loadState(): Promise<PipelineState> {
  if (!existsSync(STATE_FILE)) {
    return createEmptyState();
  }
  return loadStateUnlocked();
}

/**
 * 保存状态（原子写：tmp + rename，加锁防止并发覆盖）
 */
export async function saveState(state: PipelineState): Promise<void> {
  await withStateLock(async () => state);
}

async function loadStateUnlocked(): Promise<PipelineState> {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = await readFile(STATE_FILE, 'utf-8');
      if (raw) return JSON.parse(raw) as PipelineState;
    }
  } catch {
    // 解析失败或读失败，落到空白
  }
  return createEmptyState();
}

async function saveStateUnlocked(state: PipelineState): Promise<void> {
  state.lastUpdatedAt = new Date().toISOString();
  await mkdir(dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await rename(tmp, STATE_FILE);
}

/**
 * 创建空白状态
 */
function createEmptyState(): PipelineState {
  const now = new Date().toISOString();
  return {
    date: now.slice(0, 10),
    currentStep: 0,
    steps: STEP_NAMES.map(name => ({ name, status: 'pending' })),
    startedAt: now,
    lastUpdatedAt: now,
    errors: [],
    completed: false,
  };
}

/**
 * 更新当前步骤状态
 */
export async function updateStep(
  stepIndex: number,
  status: StepState['status'],
  result?: unknown,
  error?: string,
): Promise<PipelineState> {
  return withStateLock(async (state) => {
    if (stepIndex >= 0 && stepIndex < state.steps.length) {
      state.steps[stepIndex].status = status;
      if (status === 'running' && !state.steps[stepIndex].startedAt) {
        state.steps[stepIndex].startedAt = new Date().toISOString();
      }
      if (status === 'completed' || status === 'failed') {
        state.steps[stepIndex].completedAt = new Date().toISOString();
      }
      if (result) state.steps[stepIndex].result = result;
      if (error) state.steps[stepIndex].error = error;
      state.currentStep = status === 'completed' ? stepIndex + 1 : stepIndex;
    }
    if (error) state.errors.push(`[${STEP_NAMES[stepIndex]}] ${error}`);
    return state;
  });
}

/**
 * 标记整个流程完成
 */
export async function markComplete(completed: boolean): Promise<PipelineState> {
  return withStateLock(async (state) => {
    state.completed = completed;
    return state;
  });
}

/**
 * 重置状态（新的一天）
 */
export async function resetForNewDay(): Promise<PipelineState> {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const fresh: PipelineState = {
    date: today,
    currentStep: 0,
    steps: STEP_NAMES.map(name => ({ name, status: 'pending' })),
    startedAt: now,
    lastUpdatedAt: now,
    errors: [],
    completed: false,
  };
  return withStateLock(async () => fresh);
}
