# Phase 2 #3 实施设计：主动学习回路

> **路线图位置**：Phase 2 §2.3
> **分支**：`worktree-feat-phase-2-active-learning-loop`（独立 worktree）
> **日期**：2026-06-03

## 0. 目标

补完回路 2 —— 把 `computePersonaValue` 的 value_score 通过移动平均（30 天窗口、α=0.3）写回 `channels.yaml` 的 `personas[].value_score`，在 `run-daily` finally 末尾挂载，扩展 `prompts-loader` 支持 `learned_*` 变量。

## 1. 现状

- `src/modules/feedback-analyzer/index.ts:44` `runWeeklyAnalysis` 写回 keywords（回路 1）
- `computePersonaValue` 算分但**不写回**（回路 2 半闭）
- `run-daily` finally 块（line 154-191）由 #2 worker 改错误处理

## 2. 设计

### 2.1 outcomes.jsonl schema

```ts
interface LeadOutcomeEvent {
  lead_id, business, persona_id: string;
  outcome: 'converted' | 'lost' | 'unresponsive';
  confidence: number;        // < 0.6 丢弃
  days_to_outcome: number;   // > 180 丢弃
  captured_at: string;       // 30 天窗口外丢弃
  source: 'manual' | 'crm_sync' | 'auto_heuristic';
}
```

zod 逐行校验，失败 log warn + 跳过。

### 2.2 feedback-applier 模块（5 个文件）

- `outcomes-loader.ts`: loadOutcomes + filterOutcomesForTraining
- `moving-average.ts`: aggregateSignalsForPersona + applyMovingAverage（α=0.3 + 冷启动 <3 样本）
- `channels-writer.ts`: updatePersonaValueScores + readOldPersonaScores
- `learned-examples.ts`: buildLearnedExamples + writeLearnedExamplesCache
- `index.ts`: applyOutcomeFeedback 主入口（永不抛，所有错误降级 skipped）

### 2.3 移动平均算法

`signal = outcomeToSignal(outcome)` ∈ {converted: 1.0, unresponsive: 0.0, lost: -0.3}
- 30 天窗口聚合：`mean → [0, 10]` 映射
- 移动平均：`α * newSignal + (1-α) * oldScore`，α=0.3
- 冷启动保护：sampleSize < 3 完全保留旧值

### 2.4 prompts-loader 扩展

`IntentSystemContext` 加 `learned_negative_examples?` / `learned_positive_patterns?` 可选字段，缺省补空数组（不抛错）。

### 2.5 run-daily finally 挂载

在 `} finally {` 块**末尾**（line 191 闭合 `}` 前）**新增**独立 try/catch：

```ts
try {
  const { applyOutcomeFeedback } = await import('../modules/feedback-applier/index.js');
  const r = await applyOutcomeFeedback({ businessDir: opts.businessDir });
  log.info({ ...r, runId }, '主动学习回路完成');
} catch (learnErr) {
  log.error({ err: learnErr, runId }, '主动学习回路异常（不阻塞）');
}
```

**不修改** #2 worker 改的现有代码（appendRunHistory / 失败告警）。

## 3. 验收

- [x] 200 fake outcomes → top25% - bottom25% ≥ 0.5（实测 3.0）
- [x] confidence < 0.6 100% 不进（实测 50/50 noise 全部过滤）
- [x] A/B 框架雏形（A 缺省 / B 提供 learned_* 渲染差异可见）
- [x] feedback-loop2-wiring.test.ts 未修改
- [x] 不引入新依赖
