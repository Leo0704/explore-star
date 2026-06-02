# Phase 2 #4 · LLM 成本优化 · 设计 spec

> **上游路线图：** `docs/roadmap.md §2.4`（Phase 2 / #4 / 1–2 人周）
> **依赖：** #1（`run_history.jsonl` schema 已含 `cost_estimate?`，但**未填**——本次填实）

## 1. 目标

让 LLM 成本**可量化、可降本、可观测**：

1. **批处理**：单条 LLM 调用 → 攒 N 条 batch 调。`analyzeBatch` 已存在（`src/modules/intent-analyzer/batch.ts:68`），**已**被 `runDailyBody` 调用，每批 `batchSize=10`（run-daily.ts:311）。初始目标 batch size **4**（保守起步，roadmap §2.4 明示）。
2. **响应级缓存**：评论文本 sha256 → 意图结果。`completeWithCache` / `cacheGet` / `cacheSet` 已存在（`src/adapters/llm/_cache.ts:166`），但** 0 调用方**（codegraph 验证），是**死代码**。本次接入到 `analyzeBatch`。
3. **成本埋点**：每次 LLM 调用记录 `prompt_tokens / completion_tokens / estimated_cost_usd`，落到 `run_history.jsonl`（沿用 Phase 0 schema，**不**改字段）。
4. **`explore-star insights` 加深**：增加"本月 LLM 成本 + 缓存命中率"页面。

## 2. 不做（roadmap §2.4 + §3 显式禁单）

- 跨进程/跨机器缓存（Redis 之类）—— **单进程**文件 cache
- 缓存自动失效策略 —— **TTL 硬上限 7 天**，**不**做动态调整
- 多家 provider 自动比价选最便宜
- 改 `LLMProvider` 接口签名返回 `{ text, usage }`（避免破坏性变更，types.ts 禁动）
- 改 `src/orchestration/run-daily.ts` 的 try/catch/finally 主结构（roadmap 锁定）

## 3. 关键决策

### 3.1 缓存 key 构造（保持现状）

`buildCacheKey(model, systemPrompt, userPrompt)` 已存在（`src/adapters/llm/_cache.ts:66`），`sha256(model + '\n' + systemPrompt + '\n' + userPrompt)`。**保持现状**——system 在 `analyzeBatch` 内**整批不变**（`run-daily.ts:294-302`），user 因评论列表内容变化——这正是我们想缓存的 key 维度。✅

### 3.2 接入点：`src/modules/intent-analyzer/batch.ts` 的 `llm.complete` 调用

`analyzeBatch`（`batch.ts:68`）内 `llm.complete(...)` 调一次（`batch.ts:105`）。**只在 `analyzeBatch` 接入**——其他 LLM 调用方（`keyword-generator.ts:24`、`rag/hook-generator`）**不**接入，理由：
- 关键词生成是**冷启动 + 低频**（每日 1 次），缓存收益小
- RAG 钩子生成是 per-lead 独立，**没有**完全重复的 user prompt
- 满足"completeWithCache 至少被 1 个 production LLM 调用方使用"的验收（`analyzeBatch` 就是）

### 3.3 Token 埋点：不改 LLMProvider 接口

**不**改 `LLMProvider.complete` 签名（types.ts 禁动）。改为**在 `analyzeBatch` 包装 `llm`**：用 `CostTracker` 包装层累加估算 token + 实际 cache 命中数。

**Token 估算**（字符数粗估）：
- 1 token ≈ 4 字符（中英文混合经验值，参考 OpenAI tiktoken）
- `prompt_tokens ≈ ceil((systemPrompt + userPrompt).length / 4)`
- `completion_tokens ≈ ceil(response.length / 4)`

**代价**：估算误差 ±20%（已知局限，roadmap §2.4 接受）。**未来升级路径**：当 LLM adapter 返回 usage 时切换到真实值（Phase 4 候选）。

**不引入** tokenizer 依赖（避免 `js-tiktoken` 5MB+ 体积）。**纯字符串**。

### 3.4 定价表来源：`LLMProvider.pricing`

已存在（`src/adapters/llm/openai-compatible.ts:31`、`anthropic.ts:19`）。**不**读 `profile.yaml`——保持「配置在代码里，profile 不引申」原则。**不**新增 hardcode 表——直接读 `llm.pricing.inputPerMTok` / `outputPerMTok`。

**计算公式**：
```
estimated_cost_usd =
  (prompt_tokens / 1_000_000) * llm.pricing.inputPerMTok
  + (completion_tokens / 1_000_000) * llm.pricing.outputPerMTok
```

### 3.5 run_history 落点：`run-daily.ts` 的 finally 块

`runDailyResult.cost_estimate` 字段已存在 schema（`run-history.ts:38-42`）。**在 `runDailyBody` 内累积**一个 `costTracker` 变量，把 `analyzeBatch` 的估算结果累加；`run-daily.ts` 收尾（finally 块 `appendRunHistory` 调用处，`run-daily.ts:157-169`）**新增一个 `cost_estimate` 字段写入 entry**。

**不**改 finally 主结构（roadmap 锁定）——**仅在 entry 对象里加一个 key**。

### 3.6 Cache TTL：硬 7 天

`src/adapters/llm/_cache.ts` **新增**：
- `const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;`
- `cacheGet` 内 `if (now - entry.createdAt > TTL) return null;`（**memory + disk 路径都加**）
- 新测试覆盖：超过 7 天的 entry 不命中

### 3.7 Insights 加深：在 `src/cli/insights.ts` 加新页面

读 `data/run_history.jsonl`，累加：
- `total_prompt_tokens`、`total_completion_tokens`、`total_cost_usd`
- `cache_hits` / `cache_misses` / `cache_hit_rate`（从 cost_tracker 数据推）
- `batch_size_distribution`（P50 / P95）

**新增** `printCostSummary(entries)` 函数，`runInsights` 末尾调用。

**注意**：`runInsights` 目前调用 `runWeeklyAnalysis`（feedback-analyzer），**不**读 run_history。新加的 cost summary **不**污染 weekly-insights.json —— 纯 console 输出。

### 3.8 cache-bust 入口（roadmap §4 风险表提到）

**Phase 2 末新增** `explore-star cache-bust <business>` 子命令（roadmap §4 风险表）。**本 spec 包含**——属于本 phase 范围。但实现**极简**：只清掉 `./data/llm-cache.jsonl` 中属于该 business 的条目（按 promptHash 前缀？不，按 key 关联 business 困难……）。

**简化方案**：`cache-bust` 默认清空整个 `./data/llm-cache.jsonl`（用户层面"重建缓存"比"选择性清"更直观）。<business> 参数可先**只校验存在**不实际过滤——这是**已知遗留**。

## 4. 实施步骤

| # | 步骤 | 验证 |
|---|------|------|
| 1 | `src/adapters/llm/_cache.ts` 加 TTL 7 天 + `isExpired(entry)` | 单元：过期 entry 不命中；新 entry 命中 |
| 2 | 新建 `src/adapters/llm/_cost-tracker.ts`：`CostTracker` 类，包装 `LLMProvider`，累加 token / cost / cache_hits | 单元：包装后 .complete() 行为一致 + 累加正确 |
| 3 | `src/modules/intent-analyzer/batch.ts`：`BatchContext.llm` 改为 CostTracker 包装的；`analyzeBatch` 走 `completeWithCache` 包装 | 单元：相同输入二次调用 fetcher count=1 |
| 4 | `src/orchestration/run-daily.ts`：`runDailyBody` 内创建 `costTracker` 传入 batchCtx；finally 块 `appendRunHistory` entry 加 `cost_estimate` | 单元：run_history 末行 entry.cost_estimate 字段存在且非 undefined |
| 5 | `src/cli/insights.ts`：加 `printCostSummary(entries)` 页面，调用 `readRunHistory` | 单元：mock entries → 输出包含「本月成本」「缓存命中率」关键字 |
| 6 | `src/cli/cache-bust.ts`（新）：清空 `./data/llm-cache.jsonl` | 单元：清空后 cacheGet 返回 null |
| 7 | `src/cli/index.ts` 注册 `cache-bust` 子命令 | 手工：npx explore-star cache-bust 执行不报错 |
| 8 | 跑 vitest 全量 + smoke | `data/run_history.jsonl` 末行 entry 有 `cost_estimate` 字段（可全 0） |

## 5. 验收（roadmap §2.4 复述）

- ✅ `completeWithCache` 至少被 1 个 production LLM 调用方使用（`analyzeBatch` 接入）
- ✅ `run_history.jsonl` 末行 `cost_estimate` 字段存在（即使为 0）
- ✅ `insights` 命令输出包含「本月 LLM 成本」「缓存命中率」段落
- ⏳ 缓存命中率 **起点 ≥ 15%** —— **真实数据** 7 天后校准（本次实施**无法在 spec 阶段量化**，但 e2e 模拟 100% 重复评论应 ≥ 80% 命中以证明机制有效）
- ⏳ 单批 batch size P50 / P95 —— **真实数据** 7 天后填；本次实现 cost_tracker 记录 batch_size 用于未来汇总

## 6. 风险与回滚（roadmap §4 适配）

| 风险 | 缓解 |
|---|---|
| 缓存导致 stale 结果 | TTL 7 天 + `cache-bust` 子命令（实现见 §3.8）|
| 估算 token 误差大 | 纯字符串长度估算 + 接受 ±20% 误差；Phase 4 升级路径留好（cost_tracker 累加接口可后续接真实 usage）|
| 改 `run-daily.ts` 与 #2 worker 冲突 | **仅在 entry 对象加 key**，不改 try/catch/finally 主结构；如冲突，rebase #2 后置 cost_estimate 字段 |
| batch 拆分规则未变 | 本次不**新加** batch 拆分逻辑（10 条/批已存在），只接入 cache + 埋点 |

## 7. 不在 spec 范围（明确不做的）

- 跨进程/跨机器 cache
- 缓存自动失效
- 多家 provider 比价
- 真实 token 数（等 provider 返回 usage 后再做）
- batch 拆分算法升级（已 10 条/批，本次不动）
- Redis 接入
- 微调 / RLHF
