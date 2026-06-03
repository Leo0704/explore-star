# 核心业务流程

## 一、每日自动化管道 (runDaily)

### Step 1: 侦察 (Reconnaissance)
- 加载业务配置 (profile.yaml)
- 登录态检查 (channel.ping)
- LLM 自动生成搜索关键词（keyword/both 模式，`keyword-generator.ts`）
- 从抖音拉取评论（按 sec_uid 或 keyword 模式）
- RateLimiter 控制 API QPS

### Step 2: 分析 (Analysis)
- 预处理（去重、过滤营销号 `marketing-filter.ts`）
- LLM 意图分析（识别高意向客户，`intent-analyzer/batch.ts`）
- LLM 熔断保护（连续 3 次失败 → OPEN 60s，飞书 critical 告警）
- RAG 钩子生成（知识库检索 + 反馈驱动风格，`rag/hook-generator.ts`）

### Step 3: 同步 (Sync)
- 写入 CRM（CSV/飞书多维表）
- 失败 lead 进入 DLQ（`data/failed/crm-sync-*.json`），后续 `retry-dlq` 重试

### Step 4: 任务生成 (Task Generation)
- 状态机推进（新发现→已关注→已互动→...）
- 智能放弃判定（3 次无回应 / opt_out 信号词检测）
- 按 persona 价值排序，生成每日任务
- 可选：钩子人工审核模式（飞书多维表 60s 轮询）

### Step 5: 执行 (Execution)
- 浏览器自动化（点赞/评论/关注/私信/发物料）
- 限速 + 人类节奏随机延迟
- 风控信号检测（验证码/封号 → 暂停/紧急停止）
- 转化引擎（加微后物料推送 + 沉默客户再激活 + 预约监听）

### Step 6: 通知 (Notification)
- 飞书/微信/邮件/控制台 告警（登录失效/运行失败/成功）

### Step 7: 健康检查 (Health Check)
- 4 类检查：系统健康 / Adapter 连通性 / 限速状态 / 紧急停止开关
- 反馈回路执行（applyOutcomeFeedback 写回 persona value_score）

---

## 二、核心实体

### 1. Lead（潜在客户）

```typescript
{
  // 身份
  cid: string;                    // 抖音评论 ID（唯一标识）
  source: 'douyin_search' | 'douyin_user_videos' | 'manual';
  aweme_id: string;               // 关联视频 ID
  video_url: string;              // 视频链接
  video_desc: string;             // 视频标题/描述（给 LLM 上下文）
  keyword: string;                // 触发该 lead 的关键词/sec_uid

  // 用户信息
  nickname: string;
  user_signature: string;         // 抖音个人签名
  follower_count: number;
  user_uid: string;

  // 评论内容
  comment_text: string;
  comment_digg_count: number;
  comment_create_time: string;    // ISO 8601

  // LLM 分析结果
  is_target_persona: boolean;
  persona: string;                // 客户画像（如 self_media, ecommerce）
  pain_point: string;             // 痛点描述（10-20 字）
  intent_score: number;           // LLM 评估的意向分数 (0-1)
  buying_stage: string;           // 购买阶段（awareness/consideration/decision）
  suggested_reply_hook: string;   // LLM 生成的评论回复钩子
  suggested_dm_hook: string;      // LLM 生成的私信钩子

  // 状态机
  status: LeadStatus;             // 状态机当前状态
  status_history: Array<{ from: LeadStatus | null; to: LeadStatus; at: string; note?: string }>;

  // 用户拒绝标记
  opt_out?: boolean;              // 用户明确拒绝，立即停止所有后续任务

  // 互动效果感知
  last_task_executed_at?: string;
  last_task_result?: '有回应' | '无回应' | '被拒' | '未执行';
  last_response_text?: string;
  execution_count: number;
  response_count: number;

  // 转化
  wechat_added_at?: string;
  booked_at?: string;
  closed_at?: string;
  revenue?: number;
  last_interaction_at?: string;

  // 反馈归因字段
  source_keyword?: string;        // 回路 1 关键词权重归因
  source_video_id?: string;
  hook_style?: string;            // 回路 2 钩子风格 A/B 归因
  detected_at?: string;

  // 元数据
  created_at: string;
  updated_at: string;
  notes?: string;
  custom_fields?: Record<string, unknown>;
}
```

### 2. Task（引导任务）

```typescript
{
  task_id: string;                // UUID
  lead_cid: string;               // 关联的 Lead
  nickname: string;
  current_state: LeadStatus;      // 执行前的 lead 状态
  next_action: TaskAction;        // like_and_follow | comment_reply | friend_request | dm | send_material
  hook: string;                   // 话术内容
  hook_style: string;             // 钩子风格（朋友推荐/顾问等）
  priority: 'high' | 'medium' | 'low';
  persona: string;
  scheduled_at: string;           // 计划执行时间（ISO 8601）
  reason: string;                 // 调度理由
  executed_at?: string;
  execution_result?: TaskResult;  // executed_with_response | executed_no_response | rejected | failed_risk | failed_network | skipped
  risk_signal?: string;
  video_url?: string;             // like_and_follow / comment_reply 需要
  user_sec_uid?: string;          // friend_request / dm 需要
  source_keyword?: string;        // 关键词归因（从 lead 透传）
}
```

### 3. LeadEvent（事件记录）

```typescript
{
  event: 'lead_status_changed' | 'lead_created' | 'task_executed' | 'touchpoint_sent' | 'touchpoint_replied';
  cid: string;
  from_status?: LeadStatus;
  to_status?: LeadStatus;
  keyword: string;
  hook_style: string;
  hook_text: string;
  persona: string;
  interaction_time: string;       // ISO 8601
  days_to_convert?: number;
  metadata?: Record<string, unknown>;
  // 触达归因字段
  touchpoint_type?: string;       // send_pdf / send_booking_link / send_followup / reactivate
  touchpoint_channel?: string;    // wechat / sms / console
  touchpoint_result?: 'opened' | 'replied' | 'booked' | 'no_response';
}
```

---

## 三、状态机（Lead 生命周期）

```
新发现 → 已关注 → 已互动 → 已加好友 → 已私信 → 已加微 → 已预约 → 已成交
                                      ↘ 已流失（3次无回应/被拒）
                                      ↘ 沉默（30天无互动）
                                      ↘ 已再激活（沉默后重新触达）
```

- `已流失` 是终态，不可回退
- 状态推进有防倒推机制（`nextStateForAction` 中 indexOf 比较）
- opt_out 检测：用户回复中含"不需要"/"别发了"/"stop" 等信号词 → 立即标记 `opt_out=true`，停止所有后续任务

---

## 四、6 个自动回路（反馈驱动优化）

| 回路 | 机制 | 作用 | 代码位置 |
|------|------|------|----------|
| 回路 1 | 关键词权重归因 | 高转化关键词权重↑，低转化↓ | `feedback-analyzer` → `computeKeywordAttribution` |
| 回路 2 | 钩子风格 A/B 测试 | 自动选择效果最好的话术风格 | `feedback-analyzer` → `computeHookStyleAttribution` |
| 回路 3 | Persona 价值排序 | 高价值客户类型优先处理 | `feedback-analyzer` → `computePersonaValue` |
| 回路 4 | 最佳互动时段 | 按 persona 选择最佳推送时间 | `feedback-analyzer` → `computeInteractionTime` |
| 回路 5 | 触达方式归因 | 分析不同触达方式（send_pdf/booking_link/followup）的效果 | `LeadEvent.touchpoint_*` 字段 |
| 回路 6 | Persona value_score 主动学习 | 读 outcomes.jsonl → 移动平均 → 写回 channels.yaml personas[].value_score | `feedback-applier` → `applyOutcomeFeedback` |

**回路 1-4** 由 `feedback-analyzer` 的 `runWeeklyAnalysis` 统一驱动，产出 `weekly-insights.json`。
**回路 6** 由 `feedback-applier` 独立驱动，在 `runDaily` 末尾执行，读 `outcomes.jsonl` 聚合后写回配置。

---

## 五、浏览器自动化（5 种动作）

| 动作 | 实现方式 |
|------|----------|
| `like_and_follow` | 点赞 + 关注作者 |
| `comment_reply` | 评论回复（逐字输入模拟人类） |
| `friend_request` | 关注用户 |
| `dm` | 发送私信 |
| `send_material` | 发送物料（PDF/链接） |

**安全机制：**
- 限速器（`rate-limiter.ts`）：按 QPS 限制抖音 API 调用（search/user_videos/comment），按天限制好友/私信
- 人类节奏随机延迟（`humanDelay`）
- 风控信号检测：captcha → 暂停 1h，account_ban → 紧急停止
- 紧急停止开关（`doctor` 命令可检查）
- 运行锁（`run-lock.ts`）：PID 文件锁，防止同机器并发跑两次，24h stale 检测

---

## 六、转化引擎

转化引擎由 4 个子模块组成，在 Step 5 执行阶段运行：

### 1. 物料推送 (`material-pusher.ts`)
- 扫描「已加微」lead，加微后 24h 延迟推送物料（PDF/链接/图片）
- 推送后记录 `touchpoint_sent` 事件

### 2. 沉默客户发现 (`dormant-finder.ts`)
- 扫描「已加微/已私信 + 30 天无互动」的 lead（`dormant_days` 可配）
- 输出沉默客户池供再激活使用

### 3. 再激活 (`reactivate.ts`)
- 对沉默客户生成个性化再激活话术（`message_template` + `{{nickname}}` 模板替换）
- 推送并更新 lead 状态为「已再激活」
- CLI 命令：`explore-star reactivate --cid=<comment_id>`

### 4. 预约监听 (`booking-listener.ts`)
- 轮询飞书日历 BookingProvider（默认 30s 间隔）
- 新预约事件 → 自动更新 lead 状态为「已预约」
- CLI 命令：`explore-star watch-bookings`

### 5. 转化日报
- `generateDailyReport` 生成每日转化报告（new_leads / new_wechat_added / new_bookings / new_deals_closed / revenue / ROI）
- 通过 notifier 推送

---

## 七、RAG 系统

### 检索 (`rag/retriever.ts`)
- 从 sqlite-vec 向量索引中 cosine 相似度 top-K 检索
- EmbeddingProvider（OpenAI / Qwen）将 query 向量化

### 钩子生成 (`rag/hook-generator.ts`)
- 检索知识库相关文档
- 选择反馈驱动的最优 hook_style（`feedback-loader.selectBestHookStyle`）
- LLM 生成个性化话术（reply 钩子 + dm 钩子）
- 写回 `lead.hook_style` 到 CRM

### 索引构建 (`rag/index-builder.ts`)
- 文档向量化，写入 sqlite-vec 索引

---

## 八、LLM 基础设施

### 1. 响应缓存 (`adapters/llm/_cache.ts`)
- sha256(model + systemPrompt + userPrompt) 去重
- 可选持久化到 `data/llm-cache.jsonl`（NDJSON）
- 相同 prompt 不重复扣费

### 2. 成本追踪 (`adapters/llm/_cost-tracker.ts`)
- CJK 字符 1.5 token/字、其他 0.25 token/字 粗估
- 累加 prompt_tokens / completion_tokens / estimated_cost_usd
- 写入 `run_history.jsonl` 的 `cost_estimate` 字段

### 3. 重试机制 (`adapters/llm/_retry.ts`)
- 429 / 5xx：指数退避（优先用 Retry-After header）
- AbortError / ECONNRESET / ETIMEDOUT：指数退避
- 默认 maxRetries=3, baseDelayMs=1000, timeoutMs=30000

### 4. 熔断器 (`core/circuit-breaker.ts`)
- 三态：CLOSED → OPEN → HALF_OPEN
- 连续 3 次失败 → OPEN 60s
- OPEN 期间所有 LLM 调用立即 reject
- onOpen 回调发飞书 critical 告警

---

## 九、适配器体系

### LLM 提供商
| 适配器 | 说明 |
|--------|------|
| `openai-compatible` | OpenAI 兼容 API（默认） |
| `anthropic` | Claude API |
| `ollama` | 本地 Ollama |

### Embedding 提供商
| 适配器 | 说明 |
|--------|------|
| `openai` | OpenAI Embedding |
| `qwen` | 通义千问 Embedding（默认） |

### CRM 适配器
| 适配器 | 说明 |
|--------|------|
| `csv` | CSV 文件存储（默认） |
| `feishu` | 飞书多维表 |

### Channel 适配器
| 适配器 | 说明 |
|--------|------|
| `douyin` | 抖音（评论/视频/用户信息） |

### Notifier 适配器
| 适配器 | 说明 |
|--------|------|
| `feishu` | 飞书机器人 |
| `wechat` | 微信 |
| `email` | 邮件 |
| `console` | 控制台输出（默认/fallback） |

### Booking 适配器
| 适配器 | 说明 |
|--------|------|
| `feishu_calendar` | 飞书日历 |

---

## 十、CRM 同步 DLQ

CRM 同步失败的 lead 进入死信队列：

1. 失败 lead 写入 `data/failed/crm-sync-*.json`
2. `explore-star retry-dlq` 命令重试（指数退避 1s → 2s → 4s，最多 3 次）
3. 单条重试（`crm.syncLeads([lead])`），一条失败不影响其它
4. 全部成功 → 删除文件
5. 仍失败 → 归档到 `data/failed/_archive/` + 飞书告警

---

## 十一、钩子人工审核模式

可选功能（`hook_review.enabled = true`）：

1. 待审核 task 写入飞书多维表（task_id / lead_cid / nickname / action / hook / hook_style / scheduled_at / 审核）
2. 阻塞 60s 轮询「审核」字段
3. 审核结果：`approved`（通过）/ `modified_hook`（修改话术）/ `skip`（跳过）
4. 无凭证时降级为直接批准

---

## 十二、配置驱动

项目通过 YAML 文件配置业务（位于 `business/<业务名>/` 目录）：

| 文件 | 作用 |
|------|------|
| `profile.yaml` | 业务画像、LLM 配置、目标人群、钩子风格、通知器 |
| `channels.yaml` | 抖音数据源配置（关键词/sec_uid）、persona 定义、关键词权重 |
| `conversion.yaml` | 转化路径、物料配置、再激活模板、预约 provider |
| `crm.yaml` | CRM 适配器配置 |
| `schedule.yaml` | 定时任务配置 |

---

## 十三、CLI 命令

```
explore-star init <name>        复制 business.example/ 到新业务目录
explore-star doctor             5 类健康检查（环境/Adapter/限速/紧急停止）
explore-star run                跑每日主流程（--business=<dir> [--dry-run] [--read-only]）
explore-star analyze            单跑意图分析
explore-star nurture            单跑引导引擎
explore-star convert            单跑转化引擎（--verbose 详细输出）
explore-star insights           跑反馈分析器（生成 weekly-insights.json）
explore-star reactivate         再激活沉默客户（--cid=<comment_id>）
explore-star watch-bookings     启动预约监听循环
explore-star configure          查看/修改业务配置
explore-star retry-dlq          重试 CRM 同步失败队列
explore-star status             查看 run 健康概览（--days / --json）
```

---

## 十四、健康检查（4 类）

| 检查类 | 内容 |
|--------|------|
| 系统健康 | 磁盘空间、cron 状态、日志文件 |
| Adapter 连通性 | LLM / CRM / Channel / Notifier 各 adapter 可达性 |
| 限速状态 | 今日任务数 / 好友数 / 私信数是否超限 |
| 紧急停止开关 | 是否被触发（captcha / account_ban 等） |

---

## 十五、事件采集层

所有 lead 事件通过 `event-recorder.ts` 写入 `data/feedback/events.jsonl`（append-only JSONL）：

- `lead_created`：新 lead 发现
- `lead_status_changed`：状态变更（含 from/to）
- `task_executed`：任务执行结果
- `touchpoint_sent`：触达发送
- `touchpoint_replied`：触达回复

供反馈分析器（回路 1-5）消费。

---

## 十六、运行历史

每次 run 结束追加一条到 `data/run_history.jsonl`（append-only JSONL）：

```typescript
{
  run_id: string;
  business: string;
  mode: 'full' | 'read-only';
  dry_run: boolean;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  exit_reason: 'completed' | 'failed' | 'login_required' | 'browser_escalated' | 'cancelled';
  step_durations: Record<string, number>;
  phase_counts: {
    videos_scanned: number;
    comments_collected: number;
    leads_created: number;
    tasks_generated: number;
    tasks_executed: number;
  };
  errors: string[];
  cost_estimate?: {
    prompt_tokens: number;
    completion_tokens: number;
    estimated_cost_usd: number;
  };
}
```

---

## 十七、数据流

```
抖音评论 → 预处理 → LLM 意图分析 → RAG 钩子生成 → Lead (CRM) → 状态机 → Task → 浏览器执行
                                                                                    ↓
                                                           事件记录 ←──── 转化引擎（物料/再激活/预约）
                                                                ↓
                                                    反馈分析（6 个回路）→ 优化权重/风格/persona
                                                                ↓
                                                    outcomes.jsonl → persona value_score 写回
```
