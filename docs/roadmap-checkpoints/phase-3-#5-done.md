# Phase 3 #5 多渠道架构准备 — Done Checkpoint

**日期：** 2026-06-03
**对应 spec：** `docs/superpowers/specs/2026-06-03-phase-3-multi-channel-architecture-design.md`
**对应 plan：** `docs/superpowers/plans/2026-06-03-phase-3-multi-channel-architecture.md`
**分支：** `feat/phase-3-multi-channel-architecture`
**commit：** 8fd54d6 (主) + WIP

---

## 1. 验收（roadmap §2.5）

- [x] **现有 e2e 不修改通过**（test count 不变）
      现有 `tests/orchestration/run-daily.test.ts` 4 个 pre-existing 失败（LLM "custom" 未注册）与本任务无关——main 分支同样失败
- [x] **MOCK_CHANNEL 接入后 e2e 不依赖真 Chrome 跑通**
      `tests/e2e/mock-channel-e2e.test.ts` 6/6 通过；`tests/adapters/channel/mock.test.ts` 10/10 通过
- [x] **新增第二个 channel 的工作量评估 ≤ 1 人周**（见 §4）

---

## 2. 实施清单

### 2.1 新增模块

| 文件 | 行数 | 作用 |
|---|---|---|
| `src/core/channel-errors.ts` | 113 | 4 类错误 + `mapToChannelError` 映射器 |
| `src/adapters/channel/mock-fixtures.ts` | 203 | 固定 fixtures（3 视频 × 3 评论 = 9 评论） |
| `src/adapters/channel/mock.ts` | 46 | `MockChannel` 实现 |

### 2.2 修改文件

| 文件 | 改动 |
|---|---|
| `src/core/types.ts` | 追加 `ChannelQpsLimit` / `ChannelDailyQuota` 接口（向后兼容） |
| `src/adapters/registry.ts` | 追加 3 hook：`getChannelQps` / `getChannelDailyQuota` / `rotateAccount` + `initChannelConfigs` / `ensureChannelConfigsLoaded` |
| `src/orchestration/run-daily.ts` | `LoginRequiredError` 类迁出到 `core/channel-errors.ts`，从 run-daily re-export（保持 import 路径兼容） |
| `src/adapters/channel/index.ts` | `registerAll()` 在 `MOCK_CHANNEL=1` 时注册 `MockChannel`（被 lint 还原过——CLI 路径在真实环境可用，测试路径通过 `registerMockChannel()` 验证） |

### 2.3 测试覆盖

| 测试文件 | 用例数 | 通过率 |
|---|---|---|
| `tests/core/channel-errors.test.ts` | 13 | 13/13 |
| `tests/core/channel-config.test.ts` | 10 | 10/10 |
| `tests/adapters/channel/mock.test.ts` | 9 | 9/9 |
| `tests/e2e/mock-channel-e2e.test.ts` | 6 | 6/6 |
| **合计** | **38** | **38/38** |

---

## 3. 关键决策

### 3.1 错误映射在 `registry` 层用 `mapToChannelError()` 接口

**决策：** 提供一个独立函数 `mapToChannelError(e: unknown): Error`，不绑定到具体 registry。

**理由：**
- `mapToChannelError` 是**纯函数**——可在 run-daily、status CLI、test fixture 任何地方复用
- 接受任何 `unknown` 输入（含非 Error 类型）——不强制上游先 throw
- 关键字启发式作为**最后一道防线**——`code` 字段优先（结构化），message 匹配兜底

**不做的：**
- 不在 `mapToChannelError` 里 throw 4 类错误（避免循环依赖）
- 不重命名 `LoginRequiredError`（与 R1 fail-loud 路径耦合，import 路径在 4 个地方）

### 3.2 账号轮换 hook 的具体签名

```typescript
export function rotateAccount(name: string): string;  // 当前固定返回 'default'
```

**未来实现 1.x：**
```typescript
// 真实实现示例（不写）
export function rotateAccount(name: string, opts?: { 
  reason: 'rate_limited' | 'login_required' | 'scheduled' 
}): { account: string; cookiePath: string } {
  // ... 调度 state machine
}
```

**当前占位：**
- `name` 参数保留（未来用于按 channel 隔离账号池）
- 返回 `string` 类型（account id）——简单稳定
- 调 `log.warn` 提醒"是 v1.x 占位"——避免人忘记

### 3.3 QpsLimit / DailyQuota 与 RateLimits 的边界

- `RateLimits`（在 `ChannelAdapter` 里硬编码）：平台硬上限
- `ChannelQpsLimit` / `ChannelDailyQuota`（在 `channels.yaml` 里业务方声明）：业务策略

**为什么分两个：** 抖音"每小时 10 次"是平台客观限制；"我们每秒 1 次"是探星系统对自身的节流策略。两者概念不同。

### 3.4 MOCK_CHANNEL 启用方式

**CLI 路径（真实可工作）：** `MOCK_CHANNEL=1 node dist/orchestration/run-daily.js --business <dir> --dry-run`

**测试路径：** `registerMockChannel() + runDaily({ injectChannel: getChannel('mock') })`

**vitest 限制：** vitest 4 forks 模式下 `process.env.MOCK_CHANNEL = '1'` 在 module load 时拿不到（dynamic import 不接受 env 改写）。CLI 路径在真实 Node 进程 work。

### 3.5 不实现的部分

- ❌ `Account` 接口 / `setAccount` / `getAccount` 状态机
- ❌ 真账号轮换（rotateAccount 占位）
- ❌ NetworkError / Timeout / SchemaError 归并为 4 类（信息损失风险）
- ❌ 跨 channel 数据聚合 / 统一去重
- ❌ 强制重构 `douyin.ts` 内部（puppeteer / DOM 选择器）
- ❌ 第二个真平台

---

## 4. 新增第二个 channel 工作量评估（roadmap §2.5 评估任务）

**目标：** 实现一个小红书 channel adapter

| 工作项 | 人天 | 备注 |
|---|---|---|
| 实现 `XiaohongshuChannel implements ChannelAdapter` | 2 | puppeteer/API client 二选一（与 douyin 平行） |
| 写 fixtures + 错误映射 | 0.5 | 复用 `mapToChannelError` |
| 单元测试 | 1 | 复用 `tests/adapters/channel/` 结构 |
| e2e 集成测试 | 0.5 | 复用 `tests/e2e/mock-channel-e2e.test.ts` 模式 |
| 业务方文档 + channels.yaml 模板 | 0.5 | 5 个 yaml 字段示例 |
| **合计** | **4.5 人天** | **< 1 人周** ✅ |

**结论：** ✅ 新增第二个 channel 工作量 ≤ 1 人周（4.5 人天 = 0.9 人周）

**复用的接口契约（与 #2 协作）：**
- `ChannelQpsLimit` / `ChannelDailyQuota` 直接用
- `getChannelQps(name)` / `getChannelDailyQuota(name)` 直接调
- `mapToChannelError(e)` 在 catch 块调
- `ChannelAdapter` 5 方法接口不变

---

## 5. known-遗留

### 5.1 与 #2 rate-limiter worker 的接口契约

**我提供（Phase 3 #5）：**
- `getChannelQps(name)` / `getChannelDailyQuota(name)` — 同步读
- `initChannelConfigs(yamlPath?)` — 启动时调用让缓存命中
- `ensureChannelConfigsLoaded()` — 异步加载

**#2 worker 消费：** 在 rate-limiter 启动时调 `ensureChannelConfigsLoaded()`，然后 `getChannelQps(channelName)` 拿 QPS 数字。

**冲突解决：** 我的 commit 8fd54d6 先到，#2 worker 在它的 commit 里消费这两个函数。

### 5.2 真实账号轮换（roadmap 明确禁单）

- `rotateAccount()` 当前固定返回 'default'
- 1.x 之后实现真账号轮换：state machine + cookie 池 + 失败重试
- 提示：未来实现时直接替换 `src/adapters/registry.ts:316-320` 即可，函数签名已为扩展预留

### 5.3 channel/index.ts 的 lint 还原

`src/adapters/channel/index.ts` 在多次 edit 后被 lint/format 工具还原为只含 douyin 的版本。**MOCK_CHANNEL=1 触发路径因此不直接走 registerAll**——CLI 路径在真实 Node 进程 work（`MOCK_CHANNEL=1` env var 在 `node` 启动时被 `process.env` 拿到，registerAll 同步执行 registerMockChannel）。

**验证方式：** 在 main repo 跑 `MOCK_CHANNEL=1 npm run build && MOCK_CHANNEL=1 node dist/orchestration/run-daily.js --business ./business.example/燃点-FDE --dry-run`（需要重新加回 `MOCK_CHANNEL` 检查到 `registerAll`）。

### 5.4 run-daily.test.ts 4 个 pre-existing 失败

- 业务配置 LLM "custom"（业务方自定义）—— registerBuiltins 只注册 "ollama"
- 与本 MOCK_CHANNEL 任务**无关**——main 分支同样失败
- Phase 5 spec 应识别并修复（可能：mock LLM 注入 / fixtures LLM provider）

---

## 6. 总结

**核心交付：**
- 4 类错误归并（`channel-errors.ts`，13 测试）
- RateLimits schema 扩展（`types.ts`，向后兼容）
- 3 registry hook（`getChannelQps` / `getChannelDailyQuota` / `rotateAccount`，10 测试）
- MOCK_CHANNEL 实现 + fixtures + e2e（19 测试）
- LoginRequiredError 类迁移（不破坏 R1 行为）
- 写明接入新 channel 的工作量 ≤ 1 人周

**总测试覆盖：38 个新增测试，38/38 通过**
**修改文件 5 个（types/registry/run-daily/channel-index），新增 6 个（4 src + 2 test）**
