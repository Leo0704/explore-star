/**
 * 状态管理（断点续传 data/state.json）
 *
 * V1.4 实现：
 *   - loadState / saveState: 读写断点状态
 *   - updateStep: 更新当前步骤
 *   - markComplete: 标记步骤完成
 *   - getResumePoint: 获取恢复点
 */
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
/**
 * 加载状态（如果不存在则创建空白）
 */
export declare function loadState(): Promise<PipelineState>;
/**
 * 保存状态
 */
export declare function saveState(state: PipelineState): Promise<void>;
/**
 * 更新当前步骤状态
 */
export declare function updateStep(stepIndex: number, status: StepState['status'], result?: unknown, error?: string): Promise<PipelineState>;
/**
 * 标记整个流程完成
 */
export declare function markComplete(completed: boolean): Promise<PipelineState>;
/**
 * 获取恢复点（用于 resume）
 */
export declare function getResumePoint(): Promise<{
    step: number;
    stepName: string;
} | null>;
/**
 * 重置状态（新的一天）
 */
export declare function resetForNewDay(): Promise<PipelineState>;
