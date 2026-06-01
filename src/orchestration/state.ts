/**
 * 状态管理（断点续传 data/state.json）
 *
 * V1.4 实现：
 *   - loadState / saveState: 读写断点状态
 *   - updateStep: 更新当前步骤
 *   - markComplete: 标记步骤完成
 *   - getResumePoint: 获取恢复点
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';

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
 * 加载状态（如果不存在则创建空白）
 */
export async function loadState(): Promise<PipelineState> {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = await readFile(STATE_FILE, 'utf-8');
      return JSON.parse(raw) as PipelineState;
    }
  } catch {
    // 忽略
  }

  return createEmptyState();
}

/**
 * 保存状态
 */
export async function saveState(state: PipelineState): Promise<void> {
  state.lastUpdatedAt = new Date().toISOString();
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
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
  const state = await loadState();
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
  await saveState(state);
  return state;
}

/**
 * 标记整个流程完成
 */
export async function markComplete(completed: boolean): Promise<PipelineState> {
  const state = await loadState();
  state.completed = completed;
  await saveState(state);
  return state;
}

/**
 * 获取恢复点（用于 resume）
 */
export async function getResumePoint(): Promise<{ step: number; stepName: string } | null> {
  const state = await loadState();
  if (state.completed) return null;

  // 找到第一个未完成的步骤
  for (let i = 0; i < state.steps.length; i++) {
    if (state.steps[i].status !== 'completed') {
      return { step: i, stepName: state.steps[i].name };
    }
  }
  return null;
}

/**
 * 重置状态（新的一天）
 */
export async function resetForNewDay(): Promise<PipelineState> {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const state: PipelineState = {
    date: today,
    currentStep: 0,
    steps: STEP_NAMES.map(name => ({ name, status: 'pending' })),
    startedAt: now,
    lastUpdatedAt: now,
    errors: [],
    completed: false,
  };
  await saveState(state);
  return state;
}