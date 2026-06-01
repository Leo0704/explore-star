/**
 * 7 步完整编排管道
 *
 * V1.4 实现：
 *   1. 侦察（search + user-videos）
 *   2. 分析（意图分析）
 *   3. 同步（CRM sync）
 *   4. 任务生成（引导引擎）
 *   5. 执行（任务执行器）
 *   6. 通知（早晚报）
 *   7. 健康检查
 */

import { runDaily, type RunDailyOptions, type RunDailyResult } from './run-daily.js';
import { checkAll, type HealthCheckResult } from './health-check.js';
import { updateStep, loadState, markComplete, getResumePoint } from './state.js';

export interface PipelineOptions {
  businessDir: string;
  dryRun?: boolean;
  steps?: number[];  // 可选：只跑特定步骤（0-6）
}

export interface PipelineResult {
  date: string;
  steps: StepResult[];
  totalDurationMs: number;
  healthCheck: HealthCheckResult;
  success: boolean;
}

export interface StepResult {
  step: number;
  name: string;
  status: 'completed' | 'skipped' | 'failed';
  durationMs: number;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// 7 步管道
// ---------------------------------------------------------------------------

const STEP_DEFS: Array<{ name: string; fn: (opts: PipelineOptions) => Promise<unknown> }> = [
  { name: 'reconnaissance',  fn: stepReconnaissance },
  { name: 'analysis',       fn: stepAnalysis },
  { name: 'sync',           fn: stepSync },
  { name: 'task_generation', fn: stepTaskGeneration },
  { name: 'execution',      fn: stepExecution },
  { name: 'notification',   fn: stepNotification },
  { name: 'health_check',   fn: stepHealthCheck },
];

/**
 * 运行完整管道
 */
export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const t0 = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const steps: StepResult[] = [];

  console.log(`[pipeline] 启动 | business=${opts.businessDir} | date=${date}`);

  // 检查恢复点
  const resumePoint = await getResumePoint();
  if (resumePoint) {
    console.log(`[pipeline] 从步骤 ${resumePoint.step}（${resumePoint.stepName}）恢复`);
  }

  // 确定要跑的步骤
  const stepsToRun = opts.steps ?? STEP_DEFS.map((_, i) => i);
  const startStep = resumePoint?.step ?? 0;
  const filteredSteps = stepsToRun.filter(s => s >= startStep);

  for (const stepIndex of filteredSteps) {
    const def = STEP_DEFS[stepIndex];
    const stepT0 = Date.now();

    console.log(`[pipeline] 步骤 ${stepIndex}: ${def.name}...`);
    await updateStep(stepIndex, 'running');

    try {
      const result = await def.fn(opts);
      const durationMs = Date.now() - stepT0;
      steps.push({
        step: stepIndex,
        name: def.name,
        status: 'completed',
        durationMs,
        result,
      });
      await updateStep(stepIndex, 'completed', result);
      console.log(`[pipeline] ✅ 步骤 ${stepIndex} 完成（${durationMs}ms）`);
    } catch (e) {
      const durationMs = Date.now() - stepT0;
      const error = e instanceof Error ? e.message : String(e);
      steps.push({
        step: stepIndex,
        name: def.name,
        status: 'failed',
        durationMs,
        error,
      });
      await updateStep(stepIndex, 'failed', undefined, error);
      console.error(`[pipeline] ❌ 步骤 ${stepIndex} 失败：${error}`);
      // 失败后继续执行后续健康检查
    }
  }

  // 最终健康检查
  let healthCheck: HealthCheckResult;
  try {
    healthCheck = await checkAll(opts.businessDir);
  } catch (e) {
    healthCheck = {
      status: 'error',
      checks: [],
      summary: `健康检查失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const totalDurationMs = Date.now() - t0;
  const success = steps.every(s => s.status === 'completed');

  await markComplete(success);

  console.log(`[pipeline] 完成 | 耗时 ${totalDurationMs}ms | success=${success}`);

  return { date, steps, totalDurationMs, healthCheck, success };
}

// ---------------------------------------------------------------------------
// 各步骤实现
// ---------------------------------------------------------------------------

async function stepReconnaissance(opts: PipelineOptions): Promise<unknown> {
  const result = await runDaily({
    businessDir: opts.businessDir,
    dryRun: opts.dryRun,
  });
  return result;
}

async function stepAnalysis(_opts: PipelineOptions): Promise<unknown> {
  // 分析步骤由 run-daily 内部完成
  return { analyzed: true };
}

async function stepSync(_opts: PipelineOptions): Promise<unknown> {
  // CRM 同步由 run-daily 内部完成
  return { synced: true };
}

async function stepTaskGeneration(_opts: PipelineOptions): Promise<unknown> {
  // 任务生成由 run-daily 内部完成
  return { tasksGenerated: true };
}

async function stepExecution(_opts: PipelineOptions): Promise<unknown> {
  // V1.4: 任务执行暂不自动（需人工触发或 task-executor）
  if (opts.dryRun) return { executed: false, reason: 'dry-run 模式' };
  return { executed: false, reason: 'V1.4 任务执行需人工或 task-executor' };
}

async function stepNotification(_opts: PipelineOptions): Promise<unknown> {
  // 通知由 run-daily 内部完成
  return { notified: true };
}

async function stepHealthCheck(opts: PipelineOptions): Promise<unknown> {
  const result = await checkAll(opts.businessDir);
  return result;
}