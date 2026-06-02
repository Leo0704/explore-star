# Phase 0 实施设计：观测与告警

> **路线图位置**：Phase 0（基础运维，地基）
> **上游**：路线图 `docs/roadmap.md` V0.2
> **范围**：5 主题之一（#1 观测与告警）

## 0. 目标与非目标

**目标（In scope）：**

1. 给 `run-daily` 加**累积可观测性**——每次 run 落一条 `run_history.jsonl`，含 run_id、起止、各 step 耗时与计数、错误、退出原因
2. 给 `run-daily` 接 **notifier**（实现完未接线状态修复）—— 收尾时上报 + LoginRequiredError 时上报
3. 新增 `explore-star status` CLI 子命令——扫 `run_history.jsonl` 输出最近 N 天 health summary

**非目标（Out of scope，留给后续）：**

- Grafana / Prometheus / OpenTelemetry（1.x 之后）
- Web dashboard（整个 v1.x 不做）
- state.json `PipelineState` ↔ run_history 关联（Phase 1 评估）
- notifier 通道选型最终化（Phase 0 仅保证 console 可用，其他通道软启动）
- 自动重试 / 熔断（Phase 1）
- LLM 成本埋点（Phase 2 #4）

## 1. 现状（已用 codegraph 核验）

| 组件 | 位置 | 现状 |
|---|---|---|
| `PipelineState` schema | `src/orchestration/state.ts:21-29` | 单日累积步骤状态，**不**含历史 |
| state.json 写入 | `src/orchestration/state.ts:111-133` | 原子 rename + proper-lockfile 互斥 |
| Notifier 接口 | `src/core/types.ts:541-544` | `{ name, send(message) }`，`NotificationMessage` 支持 title/body/level/actions |
| Notifier 实现 | `src/adapters/notifier/{console,email,feishu,wechat}.ts` | 4 个实现已写好 |
| Notifier 注册 | `src/adapters/registry.ts:96-110` | `registerNotifier` / `getNotifier` / `listNotifiers` |
| Notifier 调用现状 | `src/cli/retry-dlq.ts:38-45` / `src/modules/crm-sync/dlq.ts:26` | **仅 DLQ 子命令**调用，主流程 `run-daily.ts` **未调用** |
| notifier.yaml | 项目根 | 配置存在（具体 schema 未查） |
| `RunDailyResult` | `src/orchestration/run-daily.ts:40-49` | `{ date, videosScanned, commentsCollected, leadsCreated, tasksGenerated, tasksExecuted, duration_ms, errors: string[] }` |
| CLI 工具 | `src/cli/_shared.ts:5-21` | `extractFlag` / `showUsage` / `selfInvoke` |

**关键事实：** Notifier 链路（接口 + 4 实现 + 注册 + 调用方样板）**全栈已通**，只差 `run-daily.ts` 接线。Phase 0 不需要新增 notifier 通道，**只补主线调用**。

## 2. 设计

### 2.1 `run_history.jsonl` schema

**位置：** `data/run_history.jsonl`（与 `state.json` 同级，append-only）

**每行一个 JSON 对象**（`\n` 分隔，UTF-8，无 BOM）：

```ts
interface RunHistoryEntry {
  run_id: string;                          // crypto.randomUUID()（Node ≥ 20 内建，不引新依赖）
  business: string;                        // 业务目录绝对路径
  mode: 'full' | 'read-only';
  dry_run: boolean;
  started_at: string;                      // ISO 8601
  finished_at: string;                     // ISO 8601
  duration_ms: number;
  exit_reason: 'completed' | 'failed' | 'login_required' | 'browser_escalated' | 'cancelled';
  step_durations: Record<string, number>;  // step name → ms（来自 STEP_NAMES）
  phase_counts: {
    videos_scanned: number;
    comments_collected: number;
    leads_created: number;
    tasks_generated: number;
    tasks_executed: number;
  };
  errors: string[];                        // 跟 RunDailyResult.errors 现状一致（**不**在 Phase 0 升级为结构化）
  cost_estimate?: {                        // Phase 2 #4 用，Phase 0 字段预埋但**不写**
    prompt_tokens: number;
    completion_tokens: number;
    estimated_cost_usd: number;
  };
}
```

**关键决策：**

- **预埋 `cost_estimate` 字段**但 Phase 0 不写。理由：Phase 2 #4 上线时改 schema 比改写入路径便宜（line 兼容性靠 zod schema `partial()` 处理）。
- **`errors` 仍是字符串数组**（**与上一段 schema 一致**），**不**在 Phase 0 升级为结构化形式。理由：roadmap #2 范围会做 `{phase, severity, error, count}` 升级，那是契约改动，**先有 #2 spec 再动**。Phase 0 落 `errors: string[]` 跟 `RunDailyResult` 现状一致。
- **不使用 SQLite / 数据库**。理由：append-only JSONL 是这个数据量（每天 1-2 行/业务）最简的方案，避免引入 schema migration 工具链。

### 2.2 Notifier 接线

**触发点**（按 `run-daily.ts` 现状改造）：

```ts
// run-daily.ts 主入口伪代码
export async function runDaily(opts: RunDailyOptions): Promise<RunDailyResult> {
  const t0 = Date.now();
  const runId = ulid();                       // 新增
  const startEntry: Partial<RunHistoryEntry> = { run_id: runId, started_at: new Date().toISOString(), ... };

  let result: RunDailyResult;
  let exitReason: RunHistoryEntry['exit_reason'] = 'failed';
  let notifierError: string | undefined;

  try {
    result = await runDailyBody(opts, t0, ...);
    exitReason = result.errors.length === 0 ? 'completed' : 'failed';
  } catch (e) {
    if (e instanceof LoginRequiredError) {
      exitReason = 'login_required';
      // 立即通知（不等 finally）
      await sendAlert(notifier, buildLoginMessage(opts, e));
      await handleLoginRequired(opts.businessDir);
    } else {
      throw e;
    }
  } finally {
    // 落 run_history（永远执行，包括 catch 路径）
    await appendRunHistory({ ...startEntry, finished_at: new Date().toISOString(), exit_reason: exitReason, ... });

    // 失败/异常路径发告警
    if (exitReason !== 'completed') {
      const alertResult = await sendAlert(notifier, buildFailureMessage(opts, startEntry, exitReason));
      notifierError = alertResult.ok ? undefined : alertResult.error;
    }
  }
  return result;
}
```

**Notifier 选择策略**（`src/core/notifier-resolver.ts` 新建）：

```ts
export function resolveNotifiers(businessDir: string): Notifier[] {
  // 1. 读 business/notifier.yaml（如果存在）
  // 2. 按顺序解析通道列表（默认 ['console']）
  // 3. 每个通道：try getNotifier(name) → 失败 log warn 跳过
  // 4. 返回成功解析的非空列表
  // 5. 全失败 → 返回 [getNotifier('console')]（兜底，绝不静默丢告警）
}
```

**关键决策：**

- **多 notifier 并行**：跟 retry-dlq 现有模式一致，按 yaml 顺序逐个发。**全部失败**才视为"未送达"，写进 `run_history` 但不阻塞主流程。
- **告警非阻塞**：notifier.send() 用 `Promise.race([send(), timeout(10s)])`。超时**不**重试，**只**记 `notifierError`。
- **失败/告警的告警不告警**：如果 notifier 也挂了，不再触发二级 notifier（避免递归）。直接 log error + 写 `not_history.notifier_error`。

### 2.3 `status` CLI 子命令

**位置：** `src/cli/status.ts`（新建，**不**动 `src/cli/insights.ts`——后者是更深度的 LLM 洞察）

**签名：**

```bash
npx explore-star status --business <dir> [--days 7] [--json]
```

**输出（默认 human-readable）：**

```
📊 探星健康概览 · 燃点-FDE · 最近 7 天

✅ Run 总数：14
❌ 失败数：2 (失败率 14.3%)
⏱  平均耗时：2m 18s
📅 今日状态：✅ 已完成（exit_reason: completed）

最近 5 次 run：
  2026-06-02 08:00  ✅ completed    2m 14s
  2026-06-01 08:00  ❌ failed       1m 02s   [auth] 飞书 CRM 401
  2026-05-31 08:00  ✅ completed    2m 22s
  2026-05-30 08:00  ⚠️  completed*  2m 31s   5 partial errors
  2026-05-29 08:00  ✅ completed    2m 09s

⚠️  7 天无 run 警告：N/A（今日已跑）
```

**`--json` 模式**：输出结构化 JSON，给其他工具/dashboard 消费。

**关键决策：**

- **不解析 state.json**：只读 `run_history.jsonl`。state.json 是当天单日状态，与 status 的"最近 N 天"语义不符。关联留给 Phase 1 评估。
- **错误 dedup top 5**：错误消息按归一化（去数字、去引号）后 group by，输出 top 5。
- **"7 天无 run 警告"**触发条件：`last_run.finished_at` 距今 > 7 × 24h。**不算** 0 run 的全新业务（区分 "从未跑过" vs "跑了但停了"）。
- **退出码**：0 = 健康或仅有部分失败；1 = 最近一次 run 是 failed/login_required/browser_escalated。让 cron 能感知。

### 2.4 文件结构

```
src/
├── core/
│   └── notifier-resolver.ts       (新增, ~50 行)
├── orchestration/
│   ├── run-history.ts             (新增, ~80 行: appendRunHistory / readRunHistory / summaryStats)
│   └── run-daily.ts               (修改: try/catch/finally + 调用 notifier + 落 run_history)
└── cli/
    └── status.ts                  (新增, ~120 行)

data/
└── run_history.jsonl              (运行时产生, 不在 git)

tests/
├── orchestration/
│   └── run-history.test.ts        (新增, schema 校验 / 累积读取)
├── cli/
│   └── status.test.ts             (新增, 解析 / dedup / 退出码)
└── e2e/
    └── observability-wiring.test.ts  (新增, mock notifier + 注入失败 → 验证告警 + 落 history)
```

## 3. 测试策略

| 层级 | 覆盖范围 | 用例要点 |
|---|---|---|
| **Unit** | `run-history.ts` schema 校验、append 原子性、读时按日期过滤 | 写 10 条后只读最近 7 天 → 正确条数；坏行不阻塞后续读（log warn 跳过） |
| **Unit** | `notifier-resolver.ts` 多通道解析、兜底 console | yaml 缺省 → 默认 ['console']；3 个通道全失败 → 返回 console；空配置 → 抛错并 log |
| **Unit** | `status` 解析 `run_history.jsonl` → human / json | 0 run / 1 run / 100 run / 含错误 / 7 天外混合 |
| **E2E** | `run-daily.ts` 完整接线 | 注入 5% LLM 失败（mock `injectLLM`）→ `run_history` 落 1 条 + notifier 触发 1 次；故意抛 `LoginRequiredError` → 立即告警 + handleLoginRequired 调用 + exit_reason = 'login_required' |
| **E2E** | `status` CLI 端到端 | 在 `business.example/燃点-FDE` 上跑一次（`--skip-llm --dry-run`）→ 跑 status → 看到 1 条 entry |

**测试友好**：

- notifier 通过 `injectNotifier?: Notifier` 注入测试实现（计数 `send` 调用次数 / 内容）
- run_history 路径通过 env var `RUN_HISTORY_PATH` 在 test 里指向 tmpdir
- console notifier 在 test 里**真的输出**（用 `vi.spyOn(console, 'log')` 断言）—— 因为 console notifier 是兜底通道，必须保证它**始终**能 deliver

## 4. 软启动 / 迁移

**风险最低的发布顺序**（以下"PR"是推荐分 PR 节奏，**不**强制；如项目用 trunk-based 自行合并）：

1. **PR 1**：`run_history.jsonl` 写入 + `run-daily.ts` 接线，**notifier 全部 disable**（feature flag `observability.notifier.enabled = false`）。E2E 验证：跑 3 次 run（dry-run / skip-llm 都算），run_history 累积 3 条。
2. **PR 2**：`notifier/console` 接入 + `status` CLI。E2E：注入失败 → console 输出告警 + status CLI 看到 failed entry。
3. **PR 3**（可选）：notifier.yaml 解析 + 多通道（email/feishu/wechat）启用。**仅在 PR 1-2 跑稳后才做**。

**Feature flag 位置：** `profile.yaml` 现有 `feedback_config.auto_apply` 旁**新增**：

```yaml
observability:
  run_history:
    enabled: true   # 默认 true，false = 行为等同 Phase 0 之前
  notifier:
    enabled: true   # 默认 true
    channels: ['console']  # 默认只 console
```

**注意**：`configure --disable` 暂不实际写文件（`configure.ts:122`），所以这两个 flag 初期需要**手动编辑** `profile.yaml`。Phase 1 末评估是否打通 configure。

**回滚：** `observability.run_history.enabled = false` → run-daily 不写 run_history（其他逻辑不变）；`observability.notifier.enabled = false` → 不发告警。

## 5. 验收（Phase 0 done criterion）

- [ ] `data/run_history.jsonl` 在 `business.example/燃点-FDE` 上累积 **≥ 3 条**真实 run entry
- [ ] `explore-star status --business ./business.example/燃点-FDE` 在最近 7 天有 run 时输出 human 格式 + 退出码 0；无 run 时输出警告 + 退出码 1
- [ ] 注入 1 次故意 LLM 失败 → console 输出一条 `level: 'critical'` 告警 + `run_history` 落 entry `exit_reason: 'failed'`
- [ ] 注入 1 次 `LoginRequiredError` → console **立即**输出一条 `level: 'critical'` 告警 + `run_history` 落 entry `exit_reason: 'login_required'` + `handleLoginRequired` 被调用
- [ ] `notifier-resolver` 在所有通道配置缺失时**兜底**返回 console notifier（**不**抛错）
- [ ] `npm test` 通过（包括新增的 e2e/observability-wiring.test.ts）
- [ ] 现有 4 个 notifier 实现（console/email/feishu/wechat）的现有 unit test 不修改通过

## 6. 已知风险

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| run_history.jsonl 在断电/进程被杀时损坏 | 进程在 `appendRunHistory` 中途被杀 | 沿用 state.json 的 `tmp + rename` 模式：写 `run_history.jsonl.tmp.<pid>` 后 rename 追加（**注意**：jsonl 不能 rename 追加，需要 "重写整个文件 + rename"）。文件 < 1MB 时这是 O(N) 写，可接受 |
| notifier.send 阻塞主流程 10s+ | SMTP / IM 服务慢 | `Promise.race` 10s 超时，失败仅 log 不重试 |
| status CLI 读大文件慢 | 跑了 365 天累积 > 1MB | jsonl 按 mtime 倒序扫，遇到 `started_at < (now - 30 days)` 提前退出。Phase 0 不优化，按需迭代 |
| `in-process` notifier 调用时主流程已 throw | finally 块里 notifier.send 抛 | notifier.send 内部 try/catch 包住，**不**让 notifier 故障放大到主流程 |

## 7. 决策记录（V0.1 已定）

1. **`run_id` 格式**：`crypto.randomUUID()`（Node ≥ 20 内建，不引新依赖）
2. **notifier.send 超时**：10s。超时**不**重试，**只**记 `notifierError`
3. **发布节奏**：3 PR 拆分（PR 1 = run_history 写入；PR 2 = console notifier + status CLI；PR 3 = 多通道可选）
4. **`status` CLI 警告区分**："从未跑过" vs "跑了但停了" **区分**（已实现）
5. **`PipelineState.run_id` 关联字段**：Phase 0 **不**补，留 Phase 1 评估
6. **Notifier 告警 rate limit**：Phase 0 **不**做，观察一周真实数据后决定

> 这些决策如有调整，由实施期反馈触发 spec V0.2 修订。

## 8. 变更记录

- V0.1：初版。从 `docs/roadmap.md` Phase 0 段展开。
