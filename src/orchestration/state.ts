import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import lockfile from 'proper-lockfile';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'state' });

export interface PipelineState {
  date: string;
  currentStep: number;
  steps: StepState[];
  startedAt: string;
  lastUpdatedAt: string;
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
  'reconnaissance',
  'analysis',
  'sync',
  'task_generation',
  'execution',
  'notification',
  'health_check',
];

export async function withStateLock(
  fn: (state: PipelineState) => Promise<Partial<PipelineState>>,
): Promise<PipelineState> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  if (!existsSync(STATE_FILE)) {
    await writeFile(STATE_FILE, JSON.stringify(createEmptyState(), null, 2), 'utf-8');
  }

  let release: () => Promise<void>;
  try {
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
    }
  }
}

export async function loadState(): Promise<PipelineState> {
  if (!existsSync(STATE_FILE)) {
    return createEmptyState();
  }
  return loadStateUnlocked();
}

export async function saveState(state: PipelineState): Promise<void> {
  await withStateLock(async () => state);
}

async function loadStateUnlocked(): Promise<PipelineState> {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = await readFile(STATE_FILE, 'utf-8');
      if (raw) return JSON.parse(raw) as PipelineState;
    }
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, 'state.json 解析失败，重置为空白状态');
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

export async function markComplete(completed: boolean): Promise<PipelineState> {
  return withStateLock(async (state) => {
    state.completed = completed;
    return state;
  });
}

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
