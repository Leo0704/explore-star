# Phase 1 实施设计：分级重试与熔断

> **路线图位置**：Phase 1（生产可用性，#2 分级重试与熔断）
> **上游**：路线图 `docs/roadmap.md` V0.2 §2.2
> **范围**：5 主题之一（#2 分级重试与熔断）
> **前置**：Phase 0（观测与告警）✅

## 0. 目标与非目标

**目标（In scope）：**

1. **三级重试预算**让单条失败不拖垮整批：
   - **评论级**（step 1 analysis）LLM 失败 → skip + 写 `data/dlq/intent-failures.jsonl`
   - **Lead 级**（step 2 sync）CRM 失败 → 现有 `crm-sync/dlq.ts` + 错误分类
   - **Step 级**（step 5 execution，仅 `mode=full`）浏览器掉线 → 重启 1 次；二次失败 → `exit_reason='browser_escalated'` + notifier
2. **per-channel 速率限制调度器**消费 `DouyinChannel.rateLimits`（目前 0 调用方）；QPS 写在 `channels.yaml`；QPS=0 触发停服 + escalate（**不**静默空跑）
3. **3 状态手写熔断器**（OPEN/CLOSED/HALF_OPEN，< 100 行）
4. **`RunDailyResult.errors` 契约升级**为 `Array<{phase, severity, error, count}>`，保留聚合语义；`run_history.jsonl` 同步升级且**向后兼容**（zod `partial`/union 兼容旧 entry）

**非目标（Out of scope，留给后续）：**

- 分布式锁 / Redis 协调（单机 + `proper-lockfile` 已够）
- 引入成熟 circuit breaker 库（手写，估 < 100 行）
- 自动无限重试（**违反 fail-loud**）
- 错误归并到 Phase 3 #5 的 4 类 channel 错误（本期只做 CRM 错误分类，不动 channel 错误模型）
- 跨进程/跨机器速率状态共享（单进程单 trigger 简单性优先）
- 自动降速（仅停服 + escalate，**不**动态调 QPS）

## 1. 现状（已用 codegraph 核验）

| 组件 | 位置 | 现状 |
|---|---|---|
| `RunDailyResult` | `src/orchestration/run-daily.ts:56-65` | `errors: string[]`（**不**含 phase/severity/count）|
| `RunHistoryEntry` | `src/orchestration/run-history.ts:20-43` | `errors: string[]`（同上）|
| `RateLimits` | `src/core/types.ts:519-525` | `{search_per_hour, user_videos_per_hour, comment_per_hour, friend_request_per_day, dm_per_day}` |
| `ChannelAdapter.rateLimits` | `src/core/types.ts:529` | 字段已声明，**0 调用方**（roadmap 明确要"让其生效"）|
| `DouyinChannel.rateLimits` | `src/adapters/channel/douyin.ts:93-96` | hard-code 5 个字段（10/30/60/5/10），未被消费 |
| `analyzeBatch` | `src/modules/intent-analyzer/batch.ts:68-169` | 整批 10 条，要么全 reject 要么全 lead，**没有**单条失败的处理路径 |
| `consumeDlq` | `src/modules/crm-sync/dlq.ts:70-175` | 已支持 retry；**未**做错误分类，syncLeads 返回的所有 error 一视同仁 |
| `executeTasks` | `src/modules/task-executor/index.ts:253-376` | 浏览器异常时 throw → 整批挂（**没有**单次重试 + 二次 escalate）|
| `BusinessProfile` | `src/core/types.ts` + `src/core/config-schemas.ts:93-129` | 无 `retry_config` 字段；`feedback_config` 旁可加 |
| `channels.yaml` | `business.example/燃点-FDE/channels.yaml` | `source.mode` / `target_sec_uids` / `search.keywords`；**无** QPS 字段 |

**关键事实：** 速率限制字段**已存在**于 adapter + type，但**没有任何**调度器读它 → 必须新增调度器；同时**必须有** 1 个消费 `DouyinChannel.rateLimits` 的位置让"channel 启动时载入"。

## 2. 设计

### 2.1 `retry_config` schema（profile.yaml 新字段）

**位置：** `business.<business>/profile.yaml`，在 `feedback_config` 旁**新增**（**不**修改现有字段）：

```yaml
retry_config:
  comment_level:           # step 1 LLM 意图分析
    enabled: true          # 默认 true，false = 失败即停（保留 Phase 0 行为）
    max_attempts: 2        # 失败后整体重试 1 次（per batch），仍失败 → DLQ
  lead_level:              # step 2 CRM 同步
    enabled: true          # 默认 true
    max_attempts: 3        # 写入失败重试 3 次
    backoff_ms: [1000, 2000, 4000]   # 指数退避
    classify_errors: true  # 错误分类（rate_limited / auth_failed / schema_invalid / unknown）
  step_level:              # step 5 浏览器执行
    enabled: true          # 仅 mode=full
    max_browser_restarts: 1   # 浏览器实例掉线 → 重启 1 次；二次失败 escalate
```

**zod schema**（`src/core/config-schemas.ts:businessProfileSchema` 内**新增**）：

```ts
const RetryConfigSchema = z.object({
  comment_level: z.object({
    enabled: z.boolean().default(true),
    max_attempts: z.number().int().positive().default(2),
  }).passthrough().optional(),
  lead_level: z.object({
    enabled: z.boolean().default(true),
    max_attempts: z.number().int().positive().default(3),
    backoff_ms: z.array(z.number().int().positive()).default([1000, 2000, 4000]),
    classify_errors: z.boolean().default(true),
  }).passthrough().optional(),
  step_level: z.object({
    enabled: z.boolean().default(true),
    max_browser_restarts: z.number().int().min(0).max(3).default(1),
  }).passthrough().optional(),
}).passthrough().optional();
```

**关键决策：**
- **3 开关全 false** = 行为完全等同 Phase 0（**不**改 `comment_level.max_attempts: 0`，避免歧义）
- **不引分布式协调**：单进程单 trigger，`backoff_ms` 数组控制重试间隔

### 2.2 错误分类（CRM 错误 → 4 类）

**位置：** `src/modules/crm-sync/error-classifier.ts`（**新**文件，~60 行）

```ts
export type CrmErrorCategory = 'rate_limited' | 'auth_failed' | 'schema_invalid' | 'unknown';

/** 把 CRM 抛出的错误或返回的 error 字符串归到 4 类之一 */
export function classifyCrmError(err: Error | string): CrmErrorCategory;
```

**分类规则**（基于错误消息文本匹配，**不**做 schema parse 以免引入信息损失）：

| 类别 | 触发模式（regex/contains）|
|---|---|
| `rate_limited` | `/rate.?limit|429|too.?many.?requests|throttle/i` |
| `auth_failed` | `/auth|401|403|token|credential|expired/i` |
| `schema_invalid` | `/schema|field|required|missing|invalid|422|400/i` |
| `unknown` | 其他 |

**关键决策：**
- **不**抛错，**不** throw —— 永远返回一个 category（避免失败路径引入二级 throw）
- **regex 大小写不敏感**（i flag）
- **DLQ 写入**：归类结果写到 lead 归档 metadata 里（`{ category, attempt_count }`），便于 retry-dlq 消费时按类决定重试策略

### 2.3 Rate Limiter 模块

**位置：** `src/core/rate-limiter.ts`（**新**文件，~100 行）

**接口：**

```ts
export interface ChannelRateLimitsConfig {
  /** 写在 channels.yaml 的 channel 级配置 */
  search_qps: number;             // 抖音搜索每秒查询数（0 = 停服）
  user_videos_qps: number;        // 拉用户视频
  comment_qps: number;            // 拉评论
  friend_request_per_day: number; // 好友申请日上限
  dm_per_day: number;             // 私信日上限
}

export class RateLimiter {
  /** 从 channels.yaml + ChannelAdapter.rateLimits 构造 */
  static fromConfig(opts: {
    channelLimits: ChannelRateLimitsConfig;
    adapterLimits: RateLimits;     // 来自 DouyinChannel.rateLimits
    notifier?: Notifier;            // QPS=0 触发停服时调用
  }): RateLimiter;

  /** 等待直到下一个 search 调用被允许（throw on QPS=0） */
  async waitForSearch(): Promise<void>;
  async waitForUserVideos(): Promise<void>;
  async waitForComment(): Promise<void>;
  /** 不等待（直接判定）；用于 daily quota 检查 */
  canFriendRequest(): boolean;
  canDm(): boolean;
  /** 增加今日计数 */
  recordFriendRequest(): void;
  recordDm(): void;
  /** QPS=0 时调一次（仅第一次）触发 stop+escalate */
  private escalateIfHalted(): Promise<void>;
}
```

**实现要点：**
- **QPS 控制**：用 token bucket 简化版（`last_call_ms + 1000/QPS` 间隔），不引 p-queue
- **QPS=0 边界**：构造时立即调 `escalateIfHalted()` 发**一次** notifier（title=`[探星] 渠道停服 QPS=0`），后续每次 wait 调用直接 throw `RateLimitHaltedError`
- **fail-loud**：`RateLimitHaltedError` 透传到 `run-daily` catch 块 → 计入 `errors: [{ phase, severity:'fatal', ... }]`，不静默
- **每日计数**走文件持久化（沿用 `task-executor` 的 `data/rate-counters-YYYY-MM-DD.json` 模式，**不**重写已有 rate limiter；本期只**新增** per-channel QPS 部分）

**`channels.yaml` 新字段**（**新增** `channel_rate_limits` 块，**不**改现有字段）：

```yaml
channel_rate_limits:
  douyin:
    search_qps: 0.5       # 默认 0.5 = 2 秒 1 次；0 = 停服
    user_videos_qps: 0.2
    comment_qps: 1.0
    friend_request_per_day: 5
    dm_per_day: 10
```

**zod schema**（`src/core/config-schemas.ts:businessProfileSchema` **不** 接受此块，因为它属 `channels.yaml`）：
- **不**引到 `businessProfileSchema`（仅在加载 `channels.yaml` 时**单独**解析）
- 新增 `channelRateLimitsSchema`（独立 export），供 `business-profile.ts` 在加载 channels 时调用

### 2.4 Circuit Breaker（手写）

**位置：** `src/core/circuit-breaker.ts`（**新**文件，估 80 行）

**状态机：**

```
CLOSED ──(failures >= threshold)──→ OPEN
OPEN   ──(now - opened_at >= cooldown_ms)──→ HALF_OPEN
HALF_OPEN ──(success)──→ CLOSED
HALF_OPEN ──(failure)──→ OPEN
```

**接口：**

```ts
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;                       // 标识（'crm-sync', 'browser-step-5'）
  failureThreshold: number;           // 默认 5
  cooldownMs: number;                 // 默认 30000
  halfOpenMaxAttempts: number;        // 默认 1
  onOpen?: (state: CircuitState) => void;   // 状态切换 hook（用于 notifier）
  injectClock?: () => number;         // 测试注入（默认 Date.now）
}

export class CircuitBreaker {
  state: CircuitState;
  failureCount: number;
  openedAt?: number;
  constructor(opts: CircuitBreakerOptions);
  async exec<T>(fn: () => Promise<T>): Promise<T>;  // throw CircuitOpenError 当 OPEN
  recordSuccess(): void;
  recordFailure(): void;
  getState(): CircuitState;
}
```

**关键决策：**
- **状态在内存**（不持久化）—— 重启进程 = 状态清零，符合 fail-loud（重启 = 重新试）
- **`onOpen` 回调发 notifier**（critical 级）—— 让熔断被人听见
- **不入 registry** —— 每个调用方（CRM、step 5 browser）自己构造一个实例
- **不**做 per-key 维度（per-cid 之类）—— 本期粒度是「这个 phase 整体」

### 2.5 契约改动：`RunDailyResult.errors` 升级

**位置：** `src/orchestration/run-daily.ts:56-65` + `src/orchestration/run-history.ts:37`

**新 schema**（**zod schema** `structuredErrorSchema`，**新增**在 `config-schemas.ts`）：

```ts
export const StructuredErrorSchema = z.object({
  phase: z.string(),                                  // 'analysis' | 'sync' | 'execution' | ...
  severity: z.enum(['fatal', 'partial']),
  error: z.string(),                                  // 人类可读
  count: z.number().int().positive(),                 // 相同错误聚合后的次数
});
export type StructuredError = z.infer<typeof StructuredErrorSchema>;
```

**新 `RunDailyResult`：**

```ts
export interface RunDailyResult {
  date: string;
  videosScanned: number;
  commentsCollected: number;
  leadsCreated: number;
  tasksGenerated: number;
  tasksExecuted: number;
  duration_ms: number;
  errors: StructuredError[];    // ← 升级
}
```

**run_history 向后兼容**（`RunHistoryEntry`）：

```ts
errors: z.union([z.array(z.string()), z.array(StructuredErrorSchema)])
```

`readRunHistory` 在 read 时**归一化**为新 schema：
- 旧 entry `errors: string[]` → 包装成 `{ phase: 'unknown', severity: 'partial', error: s, count: 1 }[]`
- 新 entry 原样使用

**`summaryStats` 升级**：

```ts
export interface RunHistoryStats {
  totalRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  topErrors: Array<{ message: string; count: number; phase?: string; severity?: string }>;
}
```

**关键决策：**
- **聚合函数** `aggregateErrors(errors: StructuredError[])`: 相同 `(phase, error)` 合并 `count`，**不**做错误归一化（保持原样去重）
- **不**写双格式——entry 内部存新格式；read 时归一化给老调用方

### 2.6 Step 5 浏览器重启（1 次 → escalate）

**位置：** `src/modules/task-executor/index.ts:253-376`（`executeTasks` 包一层 try/catch）

**逻辑：**

```ts
let attempt = 0;
while (true) {
  try {
    return await realExecuteTasks(tasks, config, opts);
  } catch (e) {
    if (isBrowserDisconnect(e) && attempt < retryConfig.step_level.max_browser_restarts) {
      attempt++;
      await restartBrowser();           // 调 BrowserBridge.close + connect
      log.warn({ attempt }, '浏览器掉线，重启');
      continue;
    }
    // 二次失败（或非浏览器错）→ 抛 BrowserEscalatedError
    throw new BrowserEscalatedError('step 5 浏览器二次失败', { cause: e });
  }
}
```

**`BrowserEscalatedError`** 在 `run-daily.ts` catch 块被识别：
- `exit_reason = 'browser_escalated'`
- 立即发 critical notifier（**不**等 finally）

**isBrowserDisconnect 判定**（**不**做深度类型判断，**只**靠错误消息文本）：
- 包含 `disconnect`、`lost connection`、`target closed`、`browser has been closed`、`puppeteer-core`、`BrowserBridge`、`ECONNRESET`

**关键决策：**
- **不**包装为通用 RetryExecutor —— 浏览器重启语义特殊（涉及连接重置），单独写
- **`restartBrowser` 复用** `disconnectDouyinChannel()`（已有）+ reconnect（沿用 `getPage` 内部连接逻辑）
- **CircuitBreaker 包裹** `executeTasks`（独立实例 `name='browser-step-5'`），连续 5 次失败 → OPEN 30s → 期间直接 throw

### 2.7 文件结构

```
src/
├── core/
│   ├── rate-limiter.ts               (新增, ~100 行)
│   ├── circuit-breaker.ts            (新增, ~80 行)
│   ├── config-schemas.ts             (修改: RetryConfigSchema + StructuredErrorSchema)
│   └── business-profile.ts           (修改: 加载 channels 时解析 channel_rate_limits)
├── orchestration/
│   ├── run-daily.ts                  (修改: errors 升级 + 3 层 retry 调度 + step 5 包装)
│   └── run-history.ts                (修改: errors union 兼容 + read 归一化 + summaryStats 升级)
├── modules/
│   ├── intent-analyzer/
│   │   └── batch.ts                  (修改: 失败批写 data/dlq/intent-failures.jsonl)
│   ├── crm-sync/
│   │   ├── error-classifier.ts       (新增, ~60 行)
│   │   └── dlq.ts                    (修改: 接收错误分类，retry 决策按类)
│   └── task-executor/
│       └── index.ts                  (修改: executeTasks 包装浏览器重启 + circuit breaker)
├── adapters/
│   ├── channel/
│   │   └── douyin.ts                 (不修改, 仅 rate-limiter 消费其 rateLimits)
│   └── registry.ts                   (不修改)

data/
├── dlq/
│   └── intent-failures.jsonl         (新增, append-only)

tests/
├── core/
│   ├── rate-limiter.test.ts          (新增, ~150 行, 6+ 用例)
│   ├── circuit-breaker.test.ts       (新增, ~120 行, 5+ 用例)
│   └── config-schemas.test.ts        (修改: 新增 retry_config + structured_error 测试)
├── orchestration/
│   ├── run-daily-retry.test.ts       (新增, 注入 5% LLM 失败 / 浏览器掉线 / QPS=0)
│   └── run-history-compat.test.ts    (新增, 旧 string[] entry 仍能读)
├── modules/
│   ├── crm-sync/
│   │   ├── error-classifier.test.ts  (新增, ~80 行)
│   │   └── dlq-classify.test.ts      (修改: 按类决策重试)
│   └── intent-analyzer/
│       └── batch-dlq.test.ts         (新增, 失败批写 DLQ)
└── e2e/
    └── phase-1-retry-wiring.test.ts  (新增, 注入失败 → 验证降级但通过 + history 落 entry)
```

## 3. 测试策略

| 层级 | 覆盖范围 | 用例要点 |
|---|---|---|
| **Unit** | `error-classifier.ts` | 4 类各 1 例（带边界）+ unknown fallback |
| **Unit** | `rate-limiter.ts` | QPS=0 抛 RateLimitHaltedError + notifier 调用 1 次；QPS=0.5 在 2s 后允许；QPS=10 立即允许；quota 超额返回 false |
| **Unit** | `circuit-breaker.ts` | CLOSED→OPEN（>=threshold）；OPEN→HALF_OPEN（cooldown）；HALF_OPEN→CLOSED（success）；HALF_OPEN→OPEN（failure）；exec() 期间 OPEN throw CircuitOpenError；onOpen hook 调用 |
| **Unit** | `analyzeBatch` 失败 DLQ | llm.complete 抛 → 整批 reject + 写 DLQ；LLM 输出格式错 → 整批 reject + 写 DLQ；正常 batch 写 DLQ 0 条 |
| **Unit** | `dlq` classify | rate_limited → maxRetries 1；auth_failed → 不重试（直接归档 + 告警）；schema_invalid → 不重试（直接归档 + 告警）；unknown → 3 次 |
| **Unit** | `run-history` 兼容 | 写 string[] entry → read 归一化为 StructuredError[]；写 StructuredError[] entry → read 透传 |
| **E2E** | `runDaily` 3 层 retry | 5% LLM 失败注入 → leadsCreated ≥ 95%；浏览器掉线 mock → restart 1 次 + 二次失败 → exit_reason='browser_escalated' + notifier critical；QPS=0 in channels.yaml → RateLimitHaltedError + notifier critical + history entry 落 |
| **E2E** | smoke | `node dist/orchestration/run-daily.js --business ./business.example/燃点-FDE --skip-llm --dry-run` × 3 → run_history.jsonl ≥ 3 条 |

**测试友好：**
- RateLimiter.notifier 走 `opts.notifier` 注入
- CircuitBreaker 走 `injectClock` 注入时间
- executeTasks 走 `opts.injectExecuteTasks` 注入（已有）
- `analyzeBatch.llm` 走 `BatchContext.llm` 注入（已有）

## 4. 软启动 / 迁移

**风险最低的发布顺序**（推荐分 PR 节奏）：

1. **PR 1**：error-classifier + circuit-breaker + rate-limiter 三个核心模块（**不**接线 run-daily，单独单元测试）
2. **PR 2**：analyzeBatch 失败 DLQ + crm-sync/dlq 错误分类
3. **PR 3**：run-daily.ts 改造（3 层 retry 调度 + step 5 包装 + errors 升级 + run-history 兼容）
4. **PR 4**：真实 smoke + checkpoint doc + commit/push

**Feature flag 位置：** `profile.yaml.retry_config.{comment_level, lead_level, step_level}.enabled` 三开关默认 true；全 false = 行为等同 Phase 0。

**回滚：** 3 开关全 false 即可；不需改代码。

## 5. 验收（Phase 1 done criterion，对齐 roadmap §2.2）

- [ ] 注入 5% 故意 LLM 失败（mock `injectLLM`）→ 当日 ≥ 95% 评论仍正常出 Lead + CRM
- [ ] 制造浏览器崩溃（test inject）→ step 5 重启后继续；二次崩溃 → `run_history.exit_reason = 'browser_escalated'` + notifier 触发
- [ ] 速率限制在 `channels.yaml` 配置后生效；QPS 调 0 时**触发停服 + escalate**，**不**静默空跑
- [ ] `data/dlq/intent-failures.jsonl` 真实产生（含 cid/error/category/attempted_at）
- [ ] `npm test` 通过（新增测试 + Phase 0 5 文件 48 测试不 regression）
- [ ] 真实 smoke 3 次（`run-daily.js --skip-llm --dry-run`）→ run_history.jsonl ≥ 3 条
- [ ] `RunDailyResult.errors` 升级为 `Array<{phase, severity, error, count}>`，旧 entry 仍能读
- [ ] circuit-breaker 实际触发过 1 次（test e2e 验证）

## 6. 已知风险

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| `intent-failures.jsonl` 累积过大 | 长期不清理 | append-only JSONL，与 run_history 同模式；不优化（Phase 0 经验） |
| RateLimiter QPS 字段配错（缺/类型错） | channels.yaml schema 漂移 | zod schema 启动时 fail-fast 报错，**不**静默默认 |
| CircuitBreaker 状态内存丢失 | 进程崩 | 故意不持久化（重启 = 重新试，fail-loud） |
| BrowserEscalatedError 与 LoginRequiredError 交互 | 浏览器掉线恰好发生在 login 检测之后 | 两路独立 catch 路径，互不覆盖；run_history.exit_reason 唯一 |
| 重试 backoff 时间长阻塞 run | 3 次 × 4s = 7s 阻塞 | 主流程容许（run 通常 2-5 分钟）；如需可改 `concurrent` 但本期不做 |
| 错误分类误判（regex 不够 robust） | CRM 返回中文错误消息 | 4 类 regex 同时匹配中英文（如 `限流\|rate limit`） |

## 7. 决策记录（V0.1 已定）

1. **RateLimiter 实现方式**：自实现（token bucket 简化版，**不**引 p-queue 依赖）—— YAGNI，新增依赖要审批
2. **CircuitBreaker 状态**：内存（**不**持久化）—— 重启 = 重新试，对齐 fail-loud
3. **错误分类粒度**：4 类（rate_limited / auth_failed / schema_invalid / unknown）—— 与 roadmap §2.2 对齐
4. **`intent-failures.jsonl` 不与 crm DLQ 混**：用户明确要求分文件，便于排查"LLM 质量差" vs "CRM 接口挂"
5. **`RunDailyResult.errors` 升级方案**：union 兼容 + read 归一化 —— 旧 entry 不需迁移
6. **Step 5 浏览器重启次数**：max 1 次（二次 escalate）—— fail-loud，避免无限重试掩盖问题
7. **Channel errors 抽象延后**：本期只做 CRM 错误分类，channel 错误归并到 Phase 3 #5
8. **不**做自动降速：QPS=0 = 停服 + escalate，**不**动态调 QPS（avoid 静默降级）

> 这些决策如有调整，由实施期反馈触发 spec V0.2 修订。

## 8. 变更记录

- V0.1：初版。从 `docs/roadmap.md` Phase 1 段展开。
