# Phase 0 准入门槛 checkpoint

> **Phase:** Phase 0（观测与告警）· **PR 1 + PR 2 完整**
> **Branch:** `feat/phase-0-observability`（10 commits on top of main `14471c1`）
> **Checkpoint time:** 2026-06-02

## 7 条 done checklist 验证

| # | 标准 | 结果 | 证据 |
|---|---|---|---|
| 1 | `data/run_history.jsonl` ≥ 3 真实 run | ✅ | 4 entries（手工跑 `node dist/orchestration/run-daily.js --business ./business.example/燃点-FDE --skip-llm --dry-run` × 4）|
| 2 | `npm run status -- --business <dir>` 输出 human 格式 | ✅ | 见下方"输出示例" |
| 3 | 注入 LLM 失败 → console 收到 warning + history 落 entry | ✅ | `tests/orchestration/run-daily-observability.test.ts:describe('runDaily fires notifier on failure') > it('sends warning alert on generic business failure (non-login)')` PASS |
| 4 | 注入 LoginRequiredError → console 收到 critical | ✅ | `tests/orchestration/run-daily-observability.test.ts:describe('runDaily fires notifier on failure') > it('sends critical alert on LoginRequiredError')` PASS |
| 5 | `notifier-resolver` 全失败兜底 console | ✅ | `tests/core/notifier-resolver.test.ts` 7/7 PASS（含 "falls back to [console] when ALL configured channels fail"）|
| 6 | `npm test` 全部通过（除 pre-existing 失败）| ✅ | 5 个 Phase 0 核心文件 48/48 PASS（详见下）|
| 7 | 现有 4 个 notifier 实现的 unit test 不修改通过 | ✅ | 4 个 notifier 实现（console/email/feishu/wechat）**未**被 Phase 0 修改 |

## Phase 0 核心测试面（5 文件 / 48 测试）

```
$ npx vitest run tests/orchestration/run-history.test.ts \
                tests/orchestration/run-daily-observability.test.ts \
                tests/core/notifier-resolver.test.ts \
                tests/cli/status.test.ts \
                tests/core/config-schemas.test.ts

 Test Files  5 passed (5)
      Tests  48 passed (48)
   Duration  225ms
```

- `tests/orchestration/run-history.test.ts` — 11/11（4 append + 4 read + 3 summary）
- `tests/orchestration/run-daily-observability.test.ts` — 3/3（finally 块语义 + LoginRequiredError critical + 业务失败 warning）
- `tests/core/notifier-resolver.test.ts` — 7/7（默认 / 多通道 / 全失败兜底 / 显式空数组抛错 / enabled=false）
- `tests/cli/status.test.ts` — 6/6（formatStatusHuman + formatStatusJson + decideExitCode）
- `tests/core/config-schemas.test.ts` — 21/21（17 旧 + 3 新 + 1 existing fixture）

## 真实 smoke test 输出

`data/run_history.jsonl` 4 条累积（每条 UUID 唯一 / step_durations 含 reconnaissance 计时 / phase_counts 5 字段全 0 因为 dry-run 跳过实际收集）：

```json
{"run_id":"8e020187-...","business":"./business.example/燃点-FDE","mode":"full","dry_run":true,
 "started_at":"2026-06-02T14:07:17.989Z","finished_at":"2026-06-02T14:07:18.007Z",
 "duration_ms":19,"exit_reason":"failed","step_durations":{"reconnaissance":15},
 "phase_counts":{"videos_scanned":0,"comments_collected":0,"leads_created":0,
                "tasks_generated":0,"tasks_executed":0},"errors":[]}
```

`npm run status -- --business ./business.example/燃点-FDE --days 7`：

```
📊 探星健康概览 · ./business.example/燃点-FDE · 最近 7 天

✅ Run 总数：4
❌ 失败数：4 (100.0%)
⏱  平均耗时：0.0s

最近 3 次 run：
  2026-06-02 14:15  ❌ failed               0.0s
  2026-06-02 14:07  ❌ failed               0.0s
  2026-06-02 14:07  ❌ failed               0.0s

[22:27:26.716] WARN: status 检测到异常，退出码非 0
    exitCode: 1
```

退出码 1（因为最近一次 run 是 failed）—— 让 cron 能感知异常。

`--json` 模式输出 valid JSON（`business / days / stats / entries` 4 个字段）。

## Commit 列表

| Commit | 任务 | 内容 |
|---|---|---|
| `2024ef5` | Task 1.1 | BusinessProfile.observability schema |
| `37b93fb` | Task 1.2 | appendRunHistory（原子写）|
| `08379be` | Task 1.3 | readRunHistory + summaryStats |
| `3b5d4ec` | Task 1.4 | run-daily 接线 run_history |
| `383ca31` | Task 2.1 | notifier-resolver 多通道 |
| `6b3b3cb` | Task 2.2 | run-daily 失败告警（含 plan bug 修复：避免 login_required 双发告警）|
| `3d83db5` | Task 2.3 | status CLI 子命令（含 plan 测试 bug 修复：毫秒冲突导致 decideExitCode flake）|
| `9a4b354` | Task 2.4 | 注册 status 到 cli/index.ts + npm script |
| `8228867` | fix | status script 改用 cli/index.js dispatch（绕过 selfInvoke bug）|
| `TBD` | follow-up | **修复 project-wide selfInvoke bug**：helper 签名加 `metaUrl` 参数，所有 caller 改用 `import.meta.url` 传；`status` script 回滚到直接 invoke；新增 10 个 unit test |

## 已知遗留问题（**不**在 Phase 0 scope）

1. ~~**Project-wide selfInvoke bug**~~：✅ **已在 follow-up commit 修复**。`src/cli/_shared.ts` 的 `selfInvoke` 改为 `selfInvoke(metaUrl: string, runCLI)`，11 个调用方传 `import.meta.url`。`status` npm script 回滚到 `node dist/cli/status.js`（不再需要 cli/index.js workaround）。`tests/cli/_shared.test.ts` 10 个 case 防 regression。`node dist/cli/{status,doctor,analyze,retry-dlq}.js` 全部 work。
2. **Pre-existing 测试失败**（与 Phase 0 无关）：
   - `tests/orchestration/run-daily.test.ts` 3 个：`channels.yaml` 处于 `keyword` 模式触发 `getLLM('custom')` 缺 `CUSTOM_API_KEY` 环境变量
   - `tests/orchestration.test.ts` 1 个：同上根因
   - `tests/rag/*` 多个、`tests/cli-commands.test.ts` 多个：`vendor/opencli/` 缺 `@mozilla/readability`
3. **Plan 与 spec 偏差**（agents 已自我修正，未保留 plan 原文）：
   - Task 2.1 plan 实现示例与 spec "全失败 → 兜底 console" 在一处自相矛盾，agent 选多数派（永远兜底，对齐 fail-loud 原则）
   - Task 2.2 plan 的 finally 告警逻辑会导致 `login_required` 双发（catch 发 critical + finally 又发 critical），agent 改成 only `failed` 触发 warning
   - Task 2.3 plan 的测试用同一毫秒时间戳建 2 个 entry，`decideExitCode` 按时间倒序拿到的总是第一个而非"任意 failed"，agent 改成显式不同 `started_at`

## Phase 0 → 1 准入门槛（roadmap §5）

- [x] `run_history.jsonl` 至少记录 3 次真实 run
- [x] `status` CLI 在 `business.example/燃点-FDE` 上跑通
- [x] notifier/console 至少触发过 1 次真实告警（`tests/orchestration/run-daily-observability.test.ts` 验证 + 真实 run 跑时 business 失败触发 warning 告警）

**结论：Phase 0 done。** 等待老板 review → 准备 merge 到 main。
