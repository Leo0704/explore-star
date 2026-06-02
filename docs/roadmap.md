# 探星 v1.x 优化路线图

> **本文件不涉及代码实现**，是面向 1–2 个工程师的 7–11 周阶段规划（单人串行）；
> 若 2 人并行（Phase 2 内部 #3/#4 同时跑），可压缩到 4–6 周。
> 5 个优化主题的**实施设计**会按主题分别走 `docs/superpowers/specs/` 的 spec → plan 流程。

## 0. 总览

| 阶段 | 主题 | 关键产出 | 预估工时（人周） |
|---|---|---|---|
| Phase 0 | **#1 观测与告警** | `run_history.jsonl`（新增，append-only） + notifier 接线 + `status` CLI | 1–2 |
| Phase 1 | **#2 分级重试与熔断** | 三级重试预算 + 速率限制 + DLQ 收紧 | 2–3 |
| Phase 2 | **#3 主动学习回路** + **#4 LLM 成本优化** | feedback → persona.value_score 闭环 + batch/缓存/成本埋点（两条可并行） | 3–4 |
| Phase 3 | **#5 多渠道架构准备** | channel 接口收紧 + mock channel + 速率抽象 | 1–2 |

**核心原则**（贯穿所有阶段）：

- **fail-loud**：失败必须被**人**听到，不做静默降级（参考 [[prefer-fail-loud-over-auto-degrade]]）
- **YAGNI**：每个阶段的「不做」清单和「做」一样重要
- **测试友好**：每个 phase 必须有 e2e 验证，不依赖真 OpenCLI / Chrome

## 1. 排序逻辑

```
Phase 0   Phase 1     Phase 2              Phase 3
观测 → 重试熔断 → 主动学习 ‖ LLM 成本优化 → 多渠道抽象
            ↑             ↑            ↑
       让 #3/#4/#5     让 #4 成本   让接入第二个
       安全上线        可量化       平台成本可控
```

**为什么是这个顺序：**

- **#1 在最前**：所有后续主题的**效果都需要可观测**。没有 run_history，#3 学得对不对、#4 省了多少、#5 跨渠道失败率多少，**全凭感觉**。
- **#2 第二**：没有分级重试，#3/#4/#5 任何一条上线都可能因为"一条评论挂 = 整批挂"被一次反爬升级打回原形。这是**生产可用 vs 演示可用**的分水岭。
- **#3 和 #4 并行**：#3 是**质量向**（让 AI 更准），#4 是**成本向**（让 LLM 更省）。两者在工程上不阻塞，依赖的人/脑也错开。
- **#5 殿后**：#5 是**扩展性投资**。如果等真要接第二个平台再做，那时两个 channel 已经写出来、相互 copy-paste，抽象成本翻 3 倍。在 #1+#2 落地后做，配套的"速率限制抽象"和"账号轮换"才能站在 #2 的肩膀上。

## 2. 主题详情

### Phase 0 · #1 观测与告警（基础运维）

**问题：** `run-daily` 失败后业务方在 `errors: string[]` 数组里捞信息。框架跑挂 = 静默失活，对自动化系统来说「我以为在跑」是比「明知道挂了」危险 10 倍的状态。`notifier` 4 个实现（console/email/feishu/wechat）已经写好，但 `run-daily.ts` 没调用——**实现完未接线**。state.json 当前的 schema 是单日 `PipelineState`（断点续传用），**不**含历史累积。

**范围内：**
- **新增** `run_history.jsonl`（累积追加，**不**改现有 state.json schema）：每跑一次落一条 `{ run_id, business, started_at, finished_at, mode, step_durations, phase_counts, errors, exit_reason }`。文件位置 `data/run_history.jsonl` 与 `state.json` 同级，append-only。
- `notifier` 适配器接入 `run-daily` 收尾（run 完成 / 失败）+ `LoginRequiredError` 路径（`run-daily.ts:75` `handleLoginRequired`）。支持 1 个 or 多个 notifier（按 yaml 顺序 fallback）。
- 新增 `explore-star status --business <dir>` 子命令：扫 `run_history.jsonl` 最近 7 天，输出 run 数 / 失败率 / 平均耗时 / 错误聚合（按错误消息 dedup top 5）

**暂留待 Phase 1 决断：**
- 现有 `state.json`（`PipelineState`，含 steps/currentStep/errors）是否要 backport `run_id` 字段到 `PipelineState` 以关联两者——**不在 Phase 0 范围**，Phase 1 评估后决定

**不做：**
- Grafana / Prometheus / OpenTelemetry（**留给 1.x 之后**）
- 自建 dashboard / 前端页面（用户群是 CLI 党，ROI 极低）
- 实时流式监控（按天跑批用不上）

**依赖：** 无（独立）

**验收：**
- 故意制造一次 LLM API 失败 → `run_history.jsonl` 落异常 + notifier 触发。**延迟指标**：P50 ≤ 1 分钟（具体数字待 Phase 0 末基线测量后定，写入 spec）
- `status` 命令在 7 天无 run 时输出明确警告 + 建议检查 cron

**工时：** 1–2 人周

---

### Phase 1 · #2 分级重试与熔断（生产可用性）

**问题：** 当前失败模型是「任意一条挂 → 整批挂」。200 条评论里 1 条 LLM 超时 = 当天零产出。浏览器掉线 / Cookie 过期 / 平台反爬升级 = 全局挂。

**范围内：**
- **三级重试预算：**
  - **评论级**（step 1 analysis 意图分析）：单条 LLM 失败 → skip，记 `data/dlq/intent-failures.jsonl`（**新增文件**，不与现有 CRM DLQ 混），不阻塞后续
  - **Lead 级**（step 2 sync）：CRM 写入失败 → 进现有 `modules/crm-sync/dlq.ts` 的 DLQ（**扩展** retry-dlq CLI 的错误分类，至少分 `rate_limited / auth_failed / schema_invalid / unknown` 4 类）
  - **Step 级**（step 4 execution，仅 `--mode full` 时存在）：浏览器实例掉线 → 重启 1 次；二次失败 → 写 `run_history.exit_reason = 'browser_escalated'` 并 trigger notifier
- 引入 `p-queue` 或自实现 per-channel 速率限制（防封号），QPS 写在 `channels.yaml`
- 每个 phase 函数签名明确「是否容忍部分失败」——**这是契约改动**，`RunDailyResult.errors` 升级为 `Array<{ phase: string; severity: 'fatal' | 'partial'; error: string; count: number }>` 以保留聚合信息

**不做：**
- 自动无限重试（**违反 fail-loud 原则**）
- 分布式锁 / Redis 协调（单机 + `proper-lockfile` 已够）
- 引入成熟的 circuit breaker 库（手写 3 状态 OPEN/CLOSED/HALF_OPEN，估 < 100 行）

**关于「自动降速 vs fail-loud」的范围澄清：**
- 「反爬触发后自动降速」**不**是「失败自动降级」。前者是**预防性限流**（降低再触发概率），后者是「失败后偷偷继续」（掩盖问题）。两者本质不同。
- **降速的边界**：QPS 调到 0 = 等同于停服，**这种情况下停服 + escalate 给人才是正确动作**，不是「降到 0 继续跑」。

**依赖：** #1（需要 `run_history.jsonl` 统计失败率以调阈值）

**验收：**
- 注入 5% 故意 LLM 失败（mock `injectLLM`）→ 当日 ≥ 95% 评论仍正常出 Lead + CRM
- 制造浏览器崩溃（test inject）→ step 4 重启后继续；二次崩溃 → `run_history.exit_reason` = `browser_escalated` + notifier 触发
- 速率限制在 `channels.yaml` 配置后生效；QPS 调 0 时**触发停服 + escalate**，**不**静默空跑

**工时：** 2–3 人周

---

### Phase 2 · #3 主动学习回路（让 AI 越用越准）

**问题：** `feedback-analyzer/` 和 `e2e/feedback-loop2-wiring.test.ts` 存在，但与 `intent-analyzer`、`persona.value_score` 之间的"反馈 → 调整"回路**没接上**。等于"我们有个学习系统但没在学习"。这是把 AI 系统和 LLM 调用脚本区分开的关键。

**范围内：**
- 定义**反馈事件 schema**（落到 `data/feedback/outcomes.jsonl`）：
  ```ts
  interface LeadOutcomeEvent {
    lead_id: string;
    business: string;
    persona_id: string;
    outcome: 'converted' | 'lost' | 'unresponsive';
    confidence: number;  // 0-1，< 0.6 不进训练
    days_to_outcome: number;
    captured_at: string;  // ISO 8601
    source: 'manual' | 'crm_sync' | 'auto_heuristic';  // 区分数据来源可信度
  }
  ```
- 写 `feedback-applier` 模块（**挂载点**：run-daily 收尾 step 6 health_check 之后，**不**引入独立定时器——保持单进程单 trigger 简单性）：把 outcome 折算成 `persona.value_score` 增量更新（移动平均，窗口 = 30 天）
- intent prompt 模板支持变量 `{{learned_negative_examples}}` 和 `{{learned_positive_patterns}}`（少量样本 in-context learning）
- e2e 验证：注入 N=200 条 fake outcome（混合 3 种 outcome + 4 种 confidence）→ 验证 persona 分数有方向性变化，且 `< 0.6` 的事件被过滤

**不做：**
- 自动微调模型 / fine-tuning（那是另一层 infra 故事）
- 强化学习 / RLHF（**严重 YAGNI**）
- 自动 prompt 工程（DSPy 之类的）—— 手工迭代 + 缓存命中已覆盖 80% 优化空间
- 独立定时器 / cron 触发 `feedback-applier`（**单进程**就够，避免引入调度系统）

**依赖：** #1（需要可观测 outcome），#2（需要部分失败容错，否则反馈数据本身就不准）

**验收：**
- 模拟 200 条 outcome 后，**top 25% 高转化 persona 的 value_score 比 bottom 25% 高 ≥ 0.5 分**（**这是量化目标**，避免"显著区分"这种模糊验收）
- A/B 框架雏形：同一评论，old/new prompt 各跑一次，结果差异可见（e2e 验证）
- `confidence < 0.6` 的事件 100% 不进 `feedback-applier` 计算

**工时：** 2 人周（#3 单算）

---

### Phase 2 · #4 LLM 成本优化（批 + 缓存 + 可见）

**问题：** 不知道 LLM 调用是否走 batch、有没有缓存、每天烧多少 token。对批处理框架来说「成本是隐形的」是最大的预算风险——月 50 块到月 5000 块的过渡期没人会发现。

**范围内：**
- **批处理**：单条 LLM 调用 → 攒 N 条 batch 调（DeepSeek background API / OpenAI Batch API），目标**初始**平均 batch size ≥ **4**（**起步数字**，避免拍脑袋定 8；Phase 4 末根据真实吞吐调整）
- **响应级缓存**：评论文本 sha256 → 意图结果，重复评论直接命中（同一视频下多人评论相似的情况很常见）
- **成本埋点**：每次 LLM 调用记录 `prompt_tokens / completion_tokens / estimated_cost_usd`，落到 `run_history.jsonl`（**注意**：Phase 0 已经在 run_history 加字段，#4 不重复 schema）
- `explore-star insights` 子命令增加 "本月 LLM 成本 + 缓存命中率" 页面（已有子命令，加深）

**不做：**
- 跨进程/跨机器缓存（Redis 之类）—— 单机文件缓存够用
- 缓存自动失效策略（TTL 硬上限 7 天，**不**做动态调整）
- 多家 provider 自动比价选最便宜（**违反可预测性原则**，且 DeepSeek 已经是性价比顶）

**依赖：** #1（`run_history.jsonl` 已有 `estimated_cost_usd` 字段）

**验收：**
- 缓存命中率**起点 ≥ 15%**（保守目标，避免"30% 拍脑袋"；Phase 4 末根据真实数据校准后续目标）
- 跑 7 天真实数据后，token 用量、成本、命中率三项指标在 `insights` 可见
- 单批 batch size P50 / P95 报告在 `run_history.jsonl`

**工时：** 1–2 人周

---

### Phase 3 · #5 多渠道架构准备（为接第二平台打底）

**问题：** `adapters/channel/` 只有 `douyin-browser.ts` 是真东西。接小红书/B 站/视频号**迟早要做**。但如果等"接第二个平台时再抽象"，两个 channel 都已写出来、相互 copy-paste，抽象成本翻 3 倍。

**范围内：**
- **统一 Comment schema**：去除平台特有字段差异，所有 channel 输出标准 `Comment` 接口（**对 `douyin-browser.ts` 是接口对齐，不动内部实现**）
- **错误类型从现有错误归并为这 4 种**（registry 层做映射）：`LoginRequired / RateLimited / AntiBotTriggered / ContentUnavailable`。其他错误（NetworkError / Timeout / SchemaError 等）保持原样抛出，**不强制归并**——避免引入信息损失
- **统一速率限制抽象**：channel 自己声明 `QpsLimit / DailyQuota`（写在 `channels.yaml` 的 channel 级配置里），registry 层统一调度
- **写一个 `MOCK_CHANNEL` 实现**供 e2e 用，避免再依赖真 OpenCLI / Chrome
- channel 注册机制（`registry.ts` 已存在）增加"今日配额"和"账号轮换"hook

**不做：**
- 现在真去接第二个平台（**那是 1.0 以后的事**）
- 跨 channel 数据聚合 / 统一去重（**严重 YAGNI**，业务方一个渠道一个目录够用）
- channel 内部实现的统一（puppeteer / API client / 抓包都允许，因平台而异）
- 强制现有 `douyin-browser.ts` 重构（**只做接口对齐**，内部实现留给 2.0）

**依赖：** #2（速率限制抽象站在 #2 肩膀上）

**验收：**
- 现有 `douyin-browser.ts` 接口对齐后，**所有现有 e2e 不修改通过**（e2e/test count 不变）
- `MOCK_CHANNEL` 接入后，e2e 测试**全部**不依赖真 Chrome 跑通（具体哪些测试需在 Phase 5 spec 里识别）
- 新增第二个 channel 的**工作量评估 ≤ 1 人周**（评估任务，**不**在本路线图实施）

**工时：** 1–2 人周

## 3. 显式不做（整个 v1.x 都不做）

| 项目 | 不做的理由 |
|---|---|
| 微服务化 / 分布式部署 | 单机 SQLite + 进程锁是这体量最对的选择，拆开是负优化 |
| Web 前端 / Dashboard | 用户群是 CLI 党 + 内部运营，前端 ROI 极低 |
| 多租户 / multi-business 隔离 | 当前 CLI 单 business-dir，跑多次即可；**触发条件** = 单实例真出现 multi-tenant 需求（不只是业务数量多） |
| 实时流式触发 | 业务节奏是「每天一次批」，实时是 2.0 故事 |
| 自动模型微调 / RLHF | 工程复杂度和 ROI 严重不匹配，in-context 学习 + 权重调整足够 |
| 跨 channel 数据聚合 | 单业务单渠道足够，跨渠道是 1.0 之后 |

## 4. 风险与回滚

| 风险 | 触发条件 | 回滚方式 |
|---|---|---|
| #1 notifier 选型 / 接入延期 | 4 个 notifier 通道的发送可靠性差或选型争议大 | 软启动：先只接 `notifier/console.ts`（stdout），status CLI 同步上线；外部通道（email/feishu/wechat）作为可选 enable。**不接外部 IM 也能 ship Phase 0** |
| #2 分级重试引入新 bug 路径 | phase 函数签名改造范围超预期 | 在 `profile.yaml` 现有 `feedback_config.auto_apply` 模式旁**新增** `retry_config: { comment_level: bool, lead_level: bool, step_level: bool, max_retries: number }`，3 个开关全 false = 行为完全等同当前。**注意**：现有 `configure --disable` 子命令**暂不实际写文件**（`configure.ts:122`），所以 retry_config 初期需要**手动编辑** profile.yaml。Phase 1 末评估是否值得把 configure 真正打通 |
| #3 反馈数据噪声大 | 转化判定标准不统一 / 假阳/假阴 | `LeadOutcomeEvent.confidence: 0-1`（在 #3 范围内加），`feedback-applier` 只采纳 ≥ 0.6 的事件 |
| #4 缓存导致 stale 结果 | 业务规则变化后旧缓存命中 | TTL 硬上限 7 天 + 业务级 `explore-star cache-bust <business>` 子命令（**Phase 2 末新增**，即 topic #4 所在阶段，仅删除该业务缓存） |
| #5 抽象过度 | 现有 `douyin-browser` 改造工作量大 | 1.x 内**只收紧 channel 接口**（registry 层加方法），**不动** `douyin-browser.ts` 内部实现。2.0 再统一实现 |

## 5. Phase 准入门槛 & 进度 review

**Phase 准入门槛**（什么算上一个 phase done，能开下一个）：

| 阶段 | 进入下个 phase 的最低条件 |
|---|---|
| Phase 0 → 1 | `run_history.jsonl` 至少记录 3 次真实 run；`status` CLI 在 `business.example/燃点-FDE` 上跑通；`notifier/console` 至少触发过 1 次真实告警 |
| Phase 1 → 2 | 故意注入失败的 e2e 测试稳定通过（≥ 3 次连跑无 flake）；`retry_config` 开关三档在 `business.example` 上验证行为差异 |
| Phase 2 → 3 | `feedback-applier` e2e 注入 200 条 fake outcome 后 persona 分数有量化方向性变化；#4 跑 7 天真实数据，缓存命中率、成本、batch size P50 三项数据落到 `run_history.jsonl` 可查 |
| Phase 3 → 1.0 | 新增第二个 channel 的工作量评估**实测**（不实施，建个空骨架 channel 跑一遍）≤ 1 人周 |

**进度 review 节奏**：

- **每周一次**：工程师在项目 issue/PR 里 update 本周 phase 进度（剩余工时估算、阻塞项、scope 偏离预警）。**不**开会，文字同步即可。
- **每个 phase 收尾时**：跑准入门槛检查，doc 化结果（`docs/roadmap-checkpoints/<phase>-done.md`），**老板 review 通过**才进下个 phase。
- **遇到单 phase 超预估 50%**：暂停下个 phase，先复盘 scope 偏离原因，写入 roadmap 变更记录。

## 6. 后续（每个主题的 deep-dive）

每个 Phase 启动前，**走完整 brainstorming 流程**：

1. 在 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` 写 spec（参考已有的 `2026-06-01-explore-star-design.md` 风格）
2. spec self-review（占位符 / 一致性 / 范围 / 歧义）
3. 用户审阅 spec
4. 调 `writing-plans` skill 拆任务

**不批量**为多个主题同时写 spec —— 每个主题独立 spec → plan → 实现循环。

## 7. 变更记录

- V0.1：初版。5 主题、4 阶段、7–11 周（单人）/ 4–6 周（双人）估算。源自 2026-06-02 与老板的 brainstorming。
- V0.2：深度 self-review 第二轮修订。修正 3 个事实错误（notifier 状态、state.json schema、featureFlags 缺位）、3 个内部不一致、7 个措辞歧义 / 数字无依据、3 个缺失项（phase 准入门槛 / review 节奏 / step 名称对齐）。详见每次 Edit 的 `old_string` → `new_string` 对照。
