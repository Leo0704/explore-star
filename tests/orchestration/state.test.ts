import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import {
  loadState,
  saveState,
  updateStep,
  markComplete,
  resetForNewDay,
  withStateLock,
  type PipelineState,
} from '../../src/orchestration/state.js';

const STATE_FILE = './data/state.json';
const LOCK_FILE = './data/.state.json.lock';
const TMP_DIR = './data/tmp';

describe('state.ts — Y3 并发安全', () => {
  let backup: string | null = null;
  let hadStateFile = false;

  beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    if (existsSync(STATE_FILE)) {
      backup = await readFile(STATE_FILE, 'utf-8');
      hadStateFile = true;
    }
    if (existsSync(LOCK_FILE)) {
      await unlink(LOCK_FILE);
    }
  });

  afterAll(async () => {
    if (existsSync(LOCK_FILE)) {
      try {
        await unlink(LOCK_FILE);
      } catch { }
    }
    if (hadStateFile && backup !== null) {
      await writeFile(STATE_FILE, backup, 'utf-8');
    } else if (existsSync(STATE_FILE)) {
      try {
        await unlink(STATE_FILE);
      } catch { }
    }
  });

  it('loadState 在文件不存在时返回空白 state', async () => {
    if (existsSync(STATE_FILE)) await unlink(STATE_FILE);
    const state = await loadState();
    expect(state.steps).toHaveLength(7);
    expect(state.completed).toBe(false);
    expect(state.errors).toEqual([]);
  });

  it('saveState 写入后 loadState 能读出', async () => {
    await resetForNewDay();
    const state = await loadState();
    state.errors.push('test-marker');
    await saveState(state);
    const reloaded = await loadState();
    expect(reloaded.errors).toContain('test-marker');
  });

  it('resetForNewDay 重置为空白 state', async () => {
    const after = await resetForNewDay();
    expect(after.steps.every(s => s.status === 'pending')).toBe(true);
    expect(after.completed).toBe(false);
    expect(after.currentStep).toBe(0);
  });

  it('updateStep 正常推进单个 step', async () => {
    await resetForNewDay();
    const state = await updateStep(0, 'running');
    expect(state.steps[0].status).toBe('running');
    expect(state.steps[0].startedAt).toBeTruthy();

    const done = await updateStep(0, 'completed', { ok: true });
    expect(done.steps[0].status).toBe('completed');
    expect(done.steps[0].completedAt).toBeTruthy();
    expect(done.steps[0].result).toEqual({ ok: true });
    expect(done.currentStep).toBe(1);
  });

  it('markComplete 设置 completed 标志', async () => {
    await resetForNewDay();
    const state = await markComplete(true);
    expect(state.completed).toBe(true);
  });

  it('10 并发 updateStep 不应撕文件，最终 state.json 可解析', async () => {
    await resetForNewDay();

    const promises = Array.from({ length: 10 }, (_, i) =>
      updateStep(i % 7, 'running', { iteration: i }),
    );
    await Promise.all(promises);

    const raw = await readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as PipelineState;
    expect(parsed.date).toBeTruthy();
    expect(parsed.steps).toHaveLength(7);

    for (let i = 0; i < 7; i++) {
      expect(parsed.steps[i].status).toBe('running');
    }

    const reloaded = await loadState();
    for (let i = 0; i < 7; i++) {
      expect(reloaded.steps[i].status).toBe('running');
    }
  });

  it('withStateLock 在锁未释放前第二个调用应等待（同一进程内串行化）', async () => {
    await resetForNewDay();
    const order: number[] = [];

    const p1 = withStateLock(async (s) => {
      order.push(1);
      await new Promise(r => setTimeout(r, 100));
      s.errors.push('p1');
      order.push(2);
      return s;
    });
    const p2 = withStateLock(async (s) => {
      order.push(3);
      s.errors.push('p2');
      order.push(4);
      return s;
    });

    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('withStateLock fn 返回 partial 能正确合并到 state', async () => {
    await resetForNewDay();
    const result = await withStateLock(async (state) => {
      state.currentStep = 5;
      return { currentStep: 5, completed: true };
    });
    expect(result.currentStep).toBe(5);
    expect(result.completed).toBe(true);
    expect(result.steps).toHaveLength(7);
  });
});
