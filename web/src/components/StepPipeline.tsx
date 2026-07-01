import type { StepState } from '../api';

const STEP_LABELS: Record<string, string> = {
  reconnaissance: '侦察',
  analysis: '分析',
  sync: '同步',
  task_generation: '任务生成',
  execution: '执行',
  notification: '通知',
  health_check: '健康检查',
};

export function StepPipeline({ steps }: { steps: StepState[] }) {
  return (
    <div className="pipeline">
      {steps.map((step) => (
        <div key={step.name} className={`pipeline-step step-${step.status}`}>
          <div className="pipeline-step-name">{STEP_LABELS[step.name] ?? step.name}</div>
          <div className="pipeline-step-status">
            {step.status === 'completed' ? '✓' : step.status === 'running' ? '⟳' : step.status === 'failed' ? '✗' : '○'}
          </div>
        </div>
      ))}
    </div>
  );
}
