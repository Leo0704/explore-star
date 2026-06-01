# 探星（Explore-Star）系统设计文档

> 抖音评论截流**全自动**框架 —— 通过 OpenCLI + LLM 自动发现对**所配置业务**有真实需求的潜在客户，并提供从「侦察 → 引导 → 转化 → 反馈」的**全流程自动化**（限速 + 真人节律 + 紧急停止保障安全；钩子话术审核可选开启，详见 §1.2 / §5.2）。

| 项目 | 信息 |
|---|---|
| **代号** | 探星（Explore-Star） |
| **类型** | 开源 CLI 框架（MIT 协议） |
| **框架作者** | lylyyds |
| **默认示例业务** | `business.example/` 内置「燃点 FDE」脱敏示例（仅作参考，非框架本身的一部分） |
| **日期** | 2026-06-01 |
| **状态** | 设计阶段，待审阅 |
| **实现路线图** | 5-7 天（详见 §8，含 Day 0 准备） |

> **关于「探星」与「燃点 FDE」的关系**：本框架（探星）由 lylyyds 为自身业务（燃点 FDE）开发并开源。「探星」= 框架名（可被任何人用于任意业务）；「燃点 FDE」= 默认 `business.example/` 下的示例业务（仅展示配置方法）。二者解耦，详见 §1.4 与 §2.3。

---

## 1. 背景与目标

### 1.1 业务背景

**为什么做这个框架**：OPC（One Person Company，一一人公司）和独立开发者普遍面临一个结构性矛盾——**单客价值高、获客渠道窄、留资率差**。传统的解决方案是「打广告 + 销售团队」，但对一个人来说成本不可承受。**抖音评论区**自然聚集了大量带「明确痛点 + 即时表达」的潜在客户，是 OPC 获客最被低估的金矿。

**为什么做成开源框架**：每个 OPC 业务的具体定位（卖什么、卖给谁、怎么转化）都不同，但**从抖音评论里挖客户这件事的流程高度相似**——搜索 → 抓评论 → 意图分析 → 渐进引导 → 加微 → 转化。把流程抽象成框架，把业务参数收敛到 `business/` 目录里，就能**一次开发、千人复用**。

**默认示例业务**：`business.example/` 内置「燃点 FDE」脱敏示例（一家做小微企业 AI 落地定制的 OPC），用于演示完整配置。新用户在自己的业务上跑时，只需 `init` 一份示例并替换 `profile.yaml` 等文件即可。**该示例是配置参考，不是框架本身的组成部分**。

### 1.2 目标

构建一套**全自动的抖音评论截流框架**（**「全自动」定义**：侦察 / 引导执行 / 转化 / 反馈全流程自动运行，人只需每天看一眼日报 + 处理紧急告警；钩子话术审核可选开启），让探星能：

1. **每天自动发现** 50-200 个由业务画像定义的高意向潜在客户
2. **每天自动执行 5-20 个**引导动作（点赞 / 评论回复 / 好友申请 / 私信），由登录态浏览器自动完成，**限速 + 真人节律**保障安全
3. **7 天渐进漏斗** 完成从「陌生评论」到「加微」再到「**业务定义的下一步**」（如预约诊断、试用、咨询等）的转化，**全程无需人工干预**
4. **月成本 < 500 元**（主要是 LLM API + 飞书 API）
5. **低封号风险**（用登录态浏览器 + 真人节律 + 限速 + 紧急停止开关）

### 1.3 非目标（明确不做）

- ❌ 不做多平台（小红书 / B站 / 视频号）—— V2 扩展（V1 只做抖音）
- ❌ 不做营销号识别（只做 intent 分析）—— LLM 足够
- ❌ 不做数据对外服务（合规红线）—— 数据只本地 + 用户自选 CRM
- ❌ 不做客户付费后的项目交付管理（已有其他系统）
- ❌ 不做 SaaS 托管服务（V1 只做本地 CLI，不做 cloud）

### 1.4 开源定位

| 项目 | 决策 |
|---|---|
| **许可证** | MIT（最宽松，鼓励广泛使用）|
| **目标用户** | 会写代码的独立开发者 / 小团队 / OPC 一人公司 |
| **配置架构** | 分层配置：业务画像 + LLM prompt + CRM adapter 均可热替换 |
| **默认示例** | `business.example/燃点-FDE/` 含脱敏后的示例业务配置，新用户可一键复制 |
| **安装方式** | `git clone` + `npm install` + `npx explore-star init` |
| **运行方式** | 本地 CLI（V1）；未来支持 Docker / npx 免安装 |
| **框架定位** | 工具型开源项目（MIT）；**框架本身的商业模式**详见 §14.5；**作者个人如何使用探星**详见 `docs/business-models/`（与框架设计解耦）|

**核心定位**：
> 探星是一个**让任何独立开发者都能复用的「抖音评论截流」开源框架**。燃点 FDE 是它的第一个使用者、第一个案例、第一个贡献者。

---

## 2. 系统架构

### 2.1 三段式架构

```
                        探星系统 (Explore-Star)
                        ─────────────────────

       ① 侦察阶段                    ② 引导阶段              ③ 转化阶段
       ─────────                    ─────────              ─────────

  opencli douyin search    ─┐                            ┌─ 飞书预约表单
                            │                            │  （落地页同步）
  opencli douyin comment   ─┤                            │
                            │     ┌──────────────┐       ├─ 微信二维码
  关键词召回                │     │  引导引擎    │       │  （私信里发）
  评论抓取                  │     │              │       │
                            ├──▶  │  任务队列    │  ───▶ ├─ 获客物料（业务方配置）
  意图分析 (LLM)            │     │  每日 Top 20 │       │  （钩子 + 留资）
                            │     │              │       │
  入飞书 CRM                │     └──────────────┘       └─ 加微信
                            │            │                │
                            │            ▼                │
                            │     自动执行（登录态浏览器）│
                            │     ↓ ↓ ↓ ↓                │
                            │     点赞 / 评论回复 /        │
                            │     关注 / 私信              │
                            │     （限速 + 真人节律）      │
                            └────────────────────────────┘
```

### 2.2 端到端数据流（含「侦察 → 引导 → 转化 → 反馈」4 阶段闭环）

```
╔════════════════════════════════════════════════════════════════════╗
║  09:00  cron 触发 run-daily.ts                                    ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  ┌─ 阶段 1: 侦察 ──────────────────────────────────────────┐      ║
║  │                                                          │      ║
║  │  [1.1] opencli douyin search --query "AI 客服..."        │      ║
║  │         → 50 视频元数据                                  │      ║
║  │  [1.2] 筛选: 点赞 > 100, 评论 > 30, < 30 天             │      ║
║  │         → 20-30 高价值视频                               │      ║
║  │  [1.3] opencli douyin comment --aweme-id XXX            │      ║
║  │         → 4000-6000 原始评论                             │      ║
║  │  [1.4] 预处理: 去重/去 emoji/去营销号                    │      ║
║  │         → 3000 有效评论                                  │      ║
║  │  [1.5] LLM 意图分析 (DeepSeek-V3)                        │      ║
║  │         → 100-200 高意向 lead                            │      ║
║  │  [1.6] RAG 钩子生成 (业务知识库 + LLM)                   │      ║
║  │         → 每条 lead 含 2 个钩子                          │      ║
║  │  [1.7] CRM 同步 (飞书多维表)                             │      ║
║  │         → lead 状态: 新发现                              │      ║
║  └──────────────────────────────────────────────────────────┘      ║
║                          ↓                                         ║
║  ┌─ 阶段 2: 引导 ──────────────────────────────────────────┐      ║
║  │                                                          │      ║
║  │  [2.1] 引导引擎生成今日 Top 8 任务                       │      ║
║  │         - 按状态机分配动作 (点赞/评论/好友/私信)          │      ║
║  │         - 按 §3.6.2 互动效果感知调整                     │      ║
║  │         - 按 §3.11 关键词权重过滤                        │      ║
║  │  [2.2] 09:30 微信推送「✨ 探星早报」+ 任务清单          │      ║
║  │  [2.3] 自动执行任务（登录态浏览器 + 限速 + 真人节律）   │      ║
║  │         - 点赞 / 关注 / 评论回复 / 好友申请 / 私信      │      ║
║  │         - 每个动作间隔 3-8 秒随机                        │      ║
║  │         - 风控信号触发 → 紧急停止                        │      ║
║  │  [2.4] 自动回填互动结果到 CRM（§3.6.2）                │      ║
║  │  [2.5] 18:00 微信推送「📈 探星晚报」+ 互动统计          │      ║
║  └──────────────────────────────────────────────────────────┘      ║
║                          ↓                                         ║
║  ┌─ 阶段 3: 转化 ──────────────────────────────────────────┐      ║
║  │                                                          │      ║
║  │  [3.1] 客户加微后 24h 内：推送业务方在                    │      ║
║  │         business/conversion.yaml 中配置的                 │      ║
║  │         获客物料（PDF / 资料包 / 体验链接）               │      ║
║  │         + 转化路径入口（飞书预约 / 落地页 / 客服号）      │      ║
║  │  [3.2] 监听转化路径入口的新预约事件                       │      ║
║  │         （飞书日历 / 落地页 WebHook / 其他 BookingProvider）║
║  │         → 自动更新 lead 状态: 已加微 → 已预约            │      ║
║  │  [3.3] 客户完成诊断：CRM 状态 → 已成交 / 已流失         │      ║
║  │  [3.4] 30 天未互动客户: 进入再激活池                     │      ║
║  │         → 每月 1 日轻量触达一次                          │      ║
║  │  [3.5] 22:00 微信推送「📈 探星转化日报」                │      ║
║  │         - 漏斗 / 营收 / ROI / Hot Leads / At Risk        │      ║
║  └──────────────────────────────────────────────────────────┘      ║
║                          ↓                                         ║
║  ┌─ 阶段 4: 反馈 ──────────────────────────────────────────┐      ║
║  │                                                          │      ║
║  │  [4.1] 事件采集（贯穿所有阶段）                           │      ║
║  │         - lead 状态变化 → events.jsonl                   │      ║
║  │         - 转化触达（§3.10 recordTouchpoint）→ events     │      ║
║  │         - 钩子风格（§3.4 lead.hook_style）→ events        │      ║
║  │         - 互动时间（§3.6 scheduled_at）→ events          │      ║
║  │  [4.2] 每周日凌晨 03:00 跑反馈分析器                     │      ║
║  │         - 关键词全链路归因（→ 侦察）                      │      ║
║  │         - 钩子风格效果（→ 话术生成器）                    │      ║
║  │         - Persona 价值排序（→ 任务优先级）                │      ║
║  │         - 最佳互动时段（→ 任务推送时间）                  │      ║
║  │         - 触达方式效果（→ 转化策略）                      │      ║
║  │  [4.3] 每周一 09:00 推送「📊 探星优化建议」              │      ║
║  │  [4.4] 5 条回路同时生效：                                │      ║
║  │         回路 1: 关键词权重 → channels.yaml（自动）       │      ║
║  │         回路 2: 最优钩子风格 → generateHook()（自动）    │      ║
║  │         回路 3: persona 价值 → 任务排序（自动）          │      ║
║  │         回路 4: 最佳时段 → 任务推送时间（自动）          │      ║
║  │         回路 5: 触达策略 → 转化路径（需确认）            │      ║
║  │                                                          │      ║
║  │  ↻ 5 条回路 → 侦察 + 引导 + 转化 全链路进化 = 真正闭环  │      ║
║  └──────────────────────────────────────────────────────────┘      ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
```

**4 阶段 + 5 条回路 = 真正闭环**：
- **侦察 → 引导 → 转化** 是正向漏斗（3 个阶段各自产生数据）
- **反馈 → 侦察/引导/转化** 是 5 条反向回路（让系统全链路自适应）
  - 回路 1：关键词权重 → 侦察（已闭合）
  - 回路 2：最优钩子风格 → 话术生成器（🆕 闭合）
  - 回路 3：persona 价值排序 → 任务优先级（🆕 闭合）
  - 回路 4：最佳互动时段 → 任务推送时间（🆕 闭合）
  - 回路 5：触达方式效果 → 转化策略（🆕 闭合，需确认）
- 没有反馈回路 = 固定剧本 = 永远不能进化
- 5 条回路 = 侦察/引导/转化三个阶段都在进化 = 越用越准

---

### 2.3 Business Profile（业务画像）—— 开源核心抽象

为了让探星支持**任意业务**，所有"业务相关"配置都收敛到一个 `business/` 目录里。

**MVP 最小可用版**（前 5 分钟）：**只读 `profile.yaml` 一个文件**就能跑。

```
business/                          # 一个目录 = 一个完整业务
├── profile.yaml                   # 必读：业务核心（name/value_prop/personas/llm/crm）
│
│   # 以下目录是 V1.1+ 才用到，OPC 一人公司第一天不用管：
├── prompts/                       # 高级：自定义 LLM prompt 模板
├── knowledge/                     # 高级：RAG 知识库
├── crm.yaml                       # 高级：CRM 详细配置（profile.yaml 里也能简写）
├── channels.yaml                  # 高级：平台/关键词详细配置
└── conversion.yaml                # 高级：转化路径详细配置
```

**MVP 加载流程**（前 30 分钟就跑起来）：
```bash
git clone https://github.com/xxx/explore-star
cd explore-star
npm install
npx explore-star init my-business    # 复制示例
vim my-business/profile.yaml        # 改 3-5 个字段
npx explore-star doctor             # 检查环境
npx explore-star run --business=./my-business
```

**`profile.yaml` MVP 最小配置**——以下为**默认示例业务「燃点 FDE」**的脱敏配置（业务方在自己的业务上跑时，**必须**修改 `business.name` / `value_prop` / `target_personas` / `crm.table_id` 等字段为自己的业务信息）：
```yaml
# ===== 以下为示例：燃点 FDE =====
# 业务方需替换为：你的业务名 / 你的价值主张 / 你的目标人设 / 你的 CRM 标识
business:
  name: "燃点 FDE"  # ← 替换为：你的业务名
  value_prop: "派工程师到企业现场做定制化 AI 落地"  # ← 替换为：你的价值主张

target_personas:
  - { id: self_media, name: "自媒体矩阵" }  # ← 替换为：你的目标人设 1
  - { id: ecommerce, name: "电商" }          # ← 替换为：你的目标人设 2

llm:
  provider: deepseek
  model: deepseek-v3
  api_key_env: DEEPSEEK_API_KEY

crm:
  type: feishu  # ← 可选: notion / airtable / csv / 自定义
  table_id: "FDE意向客户池"  # ← 替换为：你的 CRM 表标识
# ===== 示例结束 =====
```

**完整版**（高级用户 / 复杂业务）：用 `prompts/` `knowledge/` `crm.yaml` 等分离配置文件，支持 RAG、模板、详细 CRM 字段映射。

---

### 2.4 配置 Schema 完整定义

> 以下 3 个 YAML 文件的完整 schema。§2.3 只给了 MVP 最小配置，这里是**完整字段**——实现时直接用。

#### 2.4.1 `profile.yaml` 完整 Schema

```yaml
# ===== profile.yaml 完整 schema =====
business:
  name: string                    # 必填：业务名称
  value_prop: string              # 必填：价值主张（一句话）
  description: string             # 可选：业务详细描述

target_personas:                  # 必填：至少 1 个
  - id: string                    # 必填：人设 ID（如 self_media, ecommerce）
    name: string                  # 必填：人设名称
    description: string           # 可选：人设描述
    typical_pain_points: string[] # 必填：典型痛点列表（供意图分析 prompt 使用）
    value_score: number           # 可选：初始价值分（默认 5.0，§3.11 反馈分析器会自动调整）

intent_signals: string[]          # 必填：意图信号词（如 ["AI 工具", "自动化", "降本"]）
                                  # 供 §3.3 意图分析 prompt 使用

buying_stages:                    # 可选：购买阶段定义（默认三段式）
  - id: string                    # 如 awareness / consideration / decision
    name: string                  # 如「刚意识到问题」/「在调研比价」/「准备找人」
    description: string           # 给 LLM 的判断标准

llm:
  provider: string                # 必填：openai / deepseek / anthropic / ollama
  model: string                   # 必填：模型名（如 deepseek-v3, gpt-4o-mini）
  api_key_env: string             # 必填：环境变量名（如 DEEPSEEK_API_KEY）
  temperature: number             # 可选：默认 0.3
  max_tokens: number              # 可选：默认 1000
  fallback:                       # 可选：降级链
    - provider: string
      model: string

crm:
  type: string                    # 必填：feishu / notion / airtable / csv / custom
  config:                         # 必填：CRM 连接配置（字段因 type 而异，见 §3.5）
    # ... 见 §3.5 crm.yaml 示例

hook_config:                      # 可选：钩子生成配置
  style: string                   # 默认风格（如「朋友推荐，不像销售」）
  max_length: number              # 最大字数（默认 30）
  language: string                # 输出语言（默认「中文」）

# 以下字段可选，V1.1+ 才用到
# prompts_dir: string            # 自定义 prompt 模板目录（默认 business/prompts/）
# knowledge_dir: string          # RAG 知识库目录（默认 business/knowledge/）
```

#### 2.4.2 `channels.yaml` 完整 Schema

```yaml
# ===== channels.yaml 完整 schema =====
# V1.4 起：探星支持两种数据源模式，二选一或都启用
#   - keyword: 用 opencli douyin search 拉视频列表（**评论数 = 0**，只取 desc+likes）
#   - target_sec_uids: 用 opencli douyin user-videos --with_comments 拉 KOL 视频+评论（**推荐**）

source:
  mode: "sec_uid"                # "sec_uid" | "keyword" | "both"（默认 sec_uid）
  # 注：sec_uid 模式能直接拿到评论，keyword 模式需要二次调用。V1 默认 sec_uid。

# === 模式 A: 关键词搜索（需要已在源码 /Users/lylyyds/Desktop/opencli/clis/douyin/search.js 实现）===
search:
  keywords:                       # 可选：关键词列表
    "AI 客服":                    # 关键词文本
      weight: 1.0                 # 权重（§3.11 反馈分析器自动调整）
    "AI 自动化":
      weight: 0.8
  # 🆕 权重边界（防止 §3.11 反馈分析器过度调优导致震荡）
  weight_min: 0.2                 # 可选：权重下限（默认 0.2，低于此值不再下调）
  weight_max: 3.0                 # 可选：权重上限（默认 3.0，高于此值不再上调）
  weight_cooldown_weeks: 3        # 可选：连续 N 周同方向调整后暂停 1 周（默认 3）
  limit_per_keyword: number       # 可选：每关键词返回视频数（默认 10，上限 30，opencli 限制）

# === 模式 B: 目标 KOL（推荐，需要 opencli douyin user-videos 已在源码实现）===
target_sec_uids:                  # 可选：目标 KOL 的 sec_uid 列表
  # V1.4 起：业务方在 business/channels.yaml 维护这串 ID。
  # 获取方式：在抖音 web 打开 KOL 主页，URL 末尾是 sec_uid（如
  # https://www.douyin.com/user/MS4wLjABAAAA...  →  MS4wLjABAAAA...）
  - "MS4wLjABAAAAxxxxxxxxxxxxxxxxxxxxx"   # KOL 1
  - "MS4wLjABAAAAyyyyyyyyyyyyyyyyyyyyy"   # KOL 2
  user_videos_limit: number       # 可选：每个 KOL 取多少视频（默认 20，opencli 限制）
  comment_limit: number           # 可选：每个视频取多少热门评论（默认 10，opencli 限制）

# === 通用筛选（两种模式共用）===
filters:                          # 可选：视频筛选条件
  min_likes: number               # 最小点赞数（默认 100）
  max_age_days: number            # 最大天数（默认 30；按视频 create_time 过滤）

comment_filters:                  # 可选：评论筛选条件
  min_length: number              # 最小字数（默认 4）
  exclude_emoji_only: boolean     # 排除纯 emoji（默认 true）
  exclude_punctuation_only: boolean # 排除纯标点（默认 true）
  exclude_marketing: boolean      # 排除营销号（默认 true，由 LLM 判断）
```

#### 2.4.3 `conversion.yaml` 完整 Schema

```yaml
# ===== conversion.yaml 完整 schema =====
lifecycle_states:                 # 必填：业务自定义生命周期状态
  - id: string                    # 如 wechat_added / booked / diagnosis / closed
    name: string                  # 如「已加微」/「已预约」/「已诊断」/「已成交」
    is_terminal: boolean          # 是否终态（已成交=true，已流失=true）

post_add_wechat:                  # 客户加微后触发
  asset:                          # 推送的获客物料
    type: string                  # pdf / link / image
    name: string                  # 物料名称（用于通知展示）
    path: string                  # 本地路径或 URL
  booking_url: string             # 预约链接（飞书日历 / 落地页）
  message_template: string        # 推送话术模板（支持 {{nickname}} 变量）

booking_provider:                 # 预约监听配置
  type: string                    # feishu_calendar / webhook / manual
  config:                         # 因 type 而异
    # feishu_calendar:
    #   calendar_id: string
    # webhook:
    #   url: string
    #   secret: string

reactivation:                     # 沉默客户再激活配置
  dormant_days: number            # 多少天算沉默（默认 30）
  max_attempts: number            # 最多再激活几次（默认 1）
  message_template: string        # 再激活话术模板

# 可选：ROI 计算
# revenue_field: string           # CRM 中的营收字段名（默认无）
# cost_per_lead: number           # 单 lead 成本估算（默认 0）
```

---

## 3. 模块详细设计

> 全部用 TypeScript/JavaScript（OpenCLI 生态）+ Node.js 脚本（数据处理）实现。
> 所有模块都有 CLI 接口，可单独运行、可被编排、可被 AI Agent 通过 `opencli-browser` skill 调用。

### 3.0 关于 Adapter 抽象

> **简化说明**：本设计把 LLM Provider / Channel Adapter / Embedding 等**架构性**的 Adapter 抽象放到 **§13.4 附录**，不在主流程章节展开。这样读者能先专注于「侦察 → 引导 → 转化 → 反馈」核心 4 阶段，架构细节按需查阅。
>
> 模块 3.3 / 3.4 / 3.5 / 3.10 / 3.11 中会引用这些 adapter（注明「见 §13.4」），但不重复定义接口。

**Adapter 一览**：

| Adapter | 接口 | 内置实现 | 用户可扩展 |
|---|---|---|---|
| **LLM Provider** | `LLMProvider` | OpenAI / DeepSeek / Anthropic / Ollama | ✅ |
| **CRM** | `CRMAdapter` | 飞书 / Notion / Airtable / 本地 CSV | ✅ |
| **Channel（平台）** | `ChannelAdapter` | 抖音（V1）| ✅ V2: 小红书 / B站 |
| **Notifier（通知）** | `Notifier` | 微信 / 飞书 / 邮件 / Slack | ✅ |
| **Embeddings** | `EmbeddingProvider` | OpenAI / 本地 bge | ✅ |

**Adapter 注册机制**（`src/adapters/registry.ts`）：
- 内置 adapter 在代码中 `registerBuiltins()`
- 用户自定义 adapter 在 `business/adapters/` 目录中放 TypeScript 文件，启动时自动加载

**详细接口规范见 §13.4 附录**。

---

### 3.1 模块 1：`opencli douyin search`（已在本地 opencli 源码实现）

**目的**：根据关键词召回抖音相关视频。

> **v1.4 状态**：✅ **已实现**——位于 `/Users/lylyyds/Desktop/opencli/clis/douyin/search.js`（对应 npm 发布版本 ≤ 1.7.4 可能尚未同步）。探星通过**调用本地源码构建版**的 `opencli` 或直接 `import` 该模块来使用。

| 项目 | 详情 |
|---|---|
| 文件 | `/Users/lylyyds/Desktop/opencli/clis/douyin/search.js`（已存在） |
| 测试文件 | `/Users/lylyyds/Desktop/opencli/clis/douyin/search.test.js`（vitest） |
| 注册方式 | `cli({ site: 'douyin', name: 'search', ... })` |
| Strategy | `Strategy.COOKIE`（**必须** Chrome Profile 已登录抖音） |
| Domain | `www.douyin.com` |

**实际接口**（实测自源码）：
```bash
opencli douyin search <query> --limit <1-30>
```

**输入参数**（来自源码 args 定义）：
| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `<query>` | ✅ | — | 搜索关键词（位置参数） |
| `--limit` | ❌ | 10 | 结果数量，**硬上限 30**（`MAX_SEARCH_LIMIT`） |
| `--format` | ❌ | table | 输出格式（json / table / csv / md / yaml） |

**实际输出**（columns: `['rank', 'desc', 'author', 'url', 'plays', 'likes', 'comments', 'shares']`）：
```json
[
  {
    "rank": 1,
    "desc": "<视频描述>",
    "author": "<作者昵称>",
    "url": "https://www.douyin.com/video/7384958671234567890",
    "plays": 0,    // ⚠️ 搜索结果页不展示，固定为 0
    "likes": 1240, // ✅ 唯一可靠的统计字段
    "comments": 0, // ⚠️ 搜索结果页不展示，固定为 0
    "shares": 0    // ⚠️ 搜索结果页不展示，固定为 0
  }
]
```

**已知限制**（v1.4 必读）：
1. **`plays` / `comments` / `shares` 恒为 0**——抖音搜索结果页 DOM 不展示这些值。如果业务需要这些字段，**必须**对每条结果调 `user-videos --with_comments`（§3.2）或后续 `aweme-detail` 接口。
2. **`aweme_id` 未直接给出**——只能从 `url` 提取（用源码里的 `extractDouyinVideoId()` 工具函数）。
3. **XHR 拦截策略失败**——抖音搜索页有 `a_bogus` 签名，XHR 直接合成返回 `verify_check` 错误。源码改用 DOM extraction（`[data-e2e="scroll-list"] li` 容器）。
4. **必须登录**——未登录返回 `AuthRequiredError`，DOM 渲染空骨架。
5. **限流**——单关键词 `--limit` 硬上限 30（业务方原本希望的 50 改为 30）。

**错误处理**（来自源码）：

| 错误类型 | 触发条件 | 处理 |
|---|---|---|
| `ArgumentError` | `--limit` 非法 / 关键词为空 | 抛出，不重试 |
| `AuthRequiredError` | 抖音登录墙 | 抛出，**不重试**；CLI 提示用户去 Chrome 登录 |
| `EmptyResultError` | 搜索结果为空 | 抛出，业务方按"无 lead"处理 |
| `CommandExecutionError` | DOM 未在 15s 内渲染（`RENDER_TIMEOUT_MS`）/ 解析失败 | 抛出，**退避 30s × 3 次**，仍失败告警 |

**探星集成方式**（**两种**）：
- **方式 1（推荐）**：`shell out` 调 `opencli douyin search <query> --limit 10 --format json`，解析 stdout JSON
- **方式 2（更稳）**：在 `package.json` 把 `opencli` 设为本地依赖 `file:/Users/lylyyds/Desktop/opencli`，`import { cli } from '@jackwener/opencli/registry'` 编程式调用

**测试**（vitest 模式）：
```javascript
// 参考 search.test.js 的 mock 模式：createPageMock({ evaluateResult: ... })
// 测试覆盖：参数校验 / login wall / empty / timeout / cards 解析
```

---

### 3.2 模块 2：抓评论——通过 `opencli douyin user-videos --with_comments`

**目的**：抓取目标 KOL 视频下的评论（探星 v1.4 主路径，**不再**为评论单独建 adapter）。

> **v1.4 架构变更**：v1.3 之前计划建 `opencli douyin comment` 独立 adapter。但本地 opencli 源码（`/Users/lylyyds/Desktop/opencli/clis/douyin/`）**没有 `comment.js`**——评论抓取能力是**内嵌**在 `user-videos.js` 的（`--with_comments` 选项）。v1.4 采用 **`target_sec_uids` 模式**：业务方维护目标 KOL 列表，对每个 KOL 调 `user-videos` 一次性拿到视频+评论，**比按关键词搜→逐视频抓评论效率高 1 个数量级**。

| 项目 | 详情 |
|---|---|
| 文件 | `/Users/lylyyds/Desktop/opencli/clis/douyin/user-videos.js`（已存在） |
| 测试文件 | `/Users/lylyyds/Desktop/opencli/clis/douyin/user-videos.test.js` |
| 共享工具 | `/Users/lylyyds/Desktop/opencli/clis/douyin/_shared/public-api.js`（`fetchDouyinUserVideos` / `fetchDouyinComments`） |

**实际接口**（实测自源码）：
```bash
opencli douyin user-videos <sec_uid> [--limit <1-20>] [--with_comments true] [--comment_limit <1-10>]
```

**输入参数**：

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `<sec_uid>` | ✅ | — | KOL 的 sec_uid（抖音用户主页 URL 末尾那段） |
| `--limit` | ❌ | 20 | 视频数量，硬上限 20（`MAX_USER_VIDEOS_LIMIT`） |
| `--with_comments` | ❌ | true | 是否带评论 |
| `--comment_limit` | ❌ | 10 | 每个视频的热门评论数，硬上限 10（`DEFAULT_COMMENT_LIMIT`） |

**实际输出**（columns: `['index', 'aweme_id', 'title', 'duration', 'digg_count', 'play_url', 'top_comments']`）：
```json
[
  {
    "index": 1,
    "aweme_id": "7384958671234567890",
    "title": "<视频 desc>",
    "duration": 45,             // 秒
    "digg_count": 1240,
    "play_url": "https://...play_addr.url_list[0]",
    "top_comments": [
      {
        "cid": "comment_xxx",
        "text": "<评论内容>",
        "user": { "nickname": "...", "uid": "...", "follower_count": 3200, "signature": "..." },
        "digg_count": 12,
        "create_time": 1717200500,
        "reply_count": 3
      }
    ]
  }
]
```

**单次调用最大吞吐**：
- 1 个 KOL × 20 视频 × 10 评论 = **200 条评论 / 调用**
- 评论抓取用 `mapInBatches(items, 4, ...)`（`USER_VIDEO_COMMENT_CONCURRENCY = 4`）并发

**探星如何获取 sec_uid**：
业务方在 `business/channels.yaml → target_sec_uids` 手动维护。如何找到 sec_uid：
1. 打开目标 KOL 抖音主页（web 端）
2. URL 形如 `https://www.douyin.com/user/MS4wLjABAAAAxxxxxx`
3. `MS4wLjABAAAAxxxxxx` 就是 sec_uid

**错误处理**：

| 错误 | 触发 | 处理 |
|---|---|---|
| `EmptyResultError` | KOL 无视频 / sec_uid 错误 | 抛出，跳过该 KOL |
| `CommandExecutionError` | 抓评论失败 | 抛出，**单视频失败不影响整体**（`top_comments = []`） |
| `AuthRequiredError` | 登录态失效 | 抛出，**全流程停止**，告警到微信 |

**V1.4 vs V1.3 决策记录**：
- ❌ 不再单独建 `comment.js`（opencli 源码没有，且 `user-videos` 已提供等效能力）
- ❌ 不再为 `search.js` 加 `aweme-detail` 二次调用（`plays/comments/shares=0` 的限制**接受**——likes 已经够做下游过滤）
- ✅ `target_sec_uids` 模式作为 V1 默认（`source.mode = sec_uid`）
- ✅ `keywords` 模式保留作 V2（等 opencli 加上 `aweme-detail` adapter 后升级）

**错误处理**：视频不存在 → 跳过 + 日志；评论被禁用 → 返回空数组；抓取超时 → 重试 2 次。

---

### 3.3 模块 3：LLM 意图分析器

**目的**：从评论中识别"高意向潜在客户"。**Prompt 模板化**——所有"业务相关"内容来自 `business/profile.yaml`。

| 项目 | 详情 |
|---|---|
| 文件 | `src/modules/intent-analyzer/index.ts` |
| Prompt 模板 | `business/prompts/intent-system.md` 和 `intent-user.md` |

**接口**：
```typescript
// CLI
npx explore-star analyze --business=./my-business \
  --input /tmp/dy-comments.json \
  --output /tmp/dy-leads.json \
  --threshold 0.7

// 函数
analyzeComments(profile: BusinessProfile, comments: Comment[]): Promise<Lead[]>
```

**输入**：
```typescript
interface Comment {
  cid: string;
  text: string;
  user: { nickname: string; signature: string; follower_count: number; };
  aweme_id: string;
  video_desc: string;  // 视频标题，给 LLM 上下文
}
```

**输出**：
```typescript
interface Lead {
  cid: string;
  aweme_id: string;
  nickname: string;
  comment_text: string;
  user_signature: string;
  follower_count: number;

  // LLM 输出（persona 字段由 profile.target_personas 决定）
  is_target_persona: boolean;
  persona: string;  // 不再硬编码 4 种
  pain_point: string;
  intent_score: number;
  buying_stage: 'awareness' | 'consideration' | 'decision';
  suggested_reply_hook: string;
  suggested_dm_hook: string;

  // 来源归因（供 §3.11 反馈分析器做全链路归因）
  source_keyword: string;    // 触发该 lead 的关键词
  source_video_id: string;   // 来源视频 ID
  detected_at: string;       // ISO 8601，lead 首次发现时间

  // 🆕 运行时状态（Bug fix：任务生成器需要按状态机推进，必须知道 lead 当前状态）
  status: LeadStatus;        // 从 CRM 同步回来时携带；新发现时默认 '新发现'

  // 🆕 钩子风格归因（Bug fix：§3.4 generateHook() 记录实际使用的风格，供 §3.11 A/B 归因）
  hook_style: string;        // 本次生成钩子时实际使用的风格（如「朋友推荐」「数据驱动」）

  // 🆕 用户拒绝标记（用户在私信/评论中明确表示拒绝 → 立即停止所有后续任务）
  opt_out: boolean;          // 默认 false；task-executor 检测到拒绝信号时设为 true

  // 🆕 互动效果字段（§3.6.2 互动效果感知 + §3.6 状态转移表依赖）
  last_task_executed_at: string | null;  // ISO 8601，上次执行任务时间
  last_task_result: TaskResult | null;   // 上次任务结果
  last_response_text: string | null;     // 对方回复内容（供 LLM 分析）
  execution_count: number;               // 累计执行次数
  response_count: number;                // 累计回应次数
}
```

**Prompt 模板**（`business/prompts/intent-system.md`）：

```markdown
你是「{{ business.name }}」的获客分析师，专精识别
{{#each business.target_personas as |p|}}{{#unless @last}}{{/unless}}「{{ p.name }}」（{{ p.description }}）{{#unless @last}}、{{/unless}}{{/each}}
对「{{ business.value_prop }}」的真实需求。

【痛点词典】
{{#each business.target_personas as |p|}}
  - {{ p.name }}: {{ join p.typical_pain_points "、" }}
{{/each}}

【判断标准】
1. 是目标人设吗？根据上面的「目标人设」清单判断。
2. 痛点真实性：
   - 表达了对{{ business.intent_signals.join('/') }}的困惑/需求/不满
     （`intent_signals` 在 `business/profile.yaml` 中定义，如「AI 工具」「法律服务」「设计方案」等）
   - 不是营销号发广告
   - 不是同行蹭流
3. 购买阶段（由 `business/profile.yaml` 的 `buying_stages` 字段定义，默认三段式）：
   - awareness：「刚意识到问题存在」
   - consideration：「在调研 / 比价」
   - decision：「准备找人 / 预算已就绪」

【输出 JSON】
{
  "is_target_persona": true/false,
  "persona": "必须是上面清单中的人设 ID",
  "pain_point": "10-20 字概括痛点",
  "intent_score": 0.0-1.0,
  "buying_stage": "awareness/consideration/decision",
  "suggested_reply_hook": "20-30 字评论回复，含具体案例钩子",
  "suggested_dm_hook": "20-30 字私信开头，有温度不套路"
}
```

→ 用户改 `profile.yaml` 即可替换业务定位，**无需改代码**。

**关键参数**：

| 参数 | 值 | 说明 |
|---|---|---|
| 模型 | `gpt-4o-mini` 或 `deepseek-v3` | 平衡质量与成本 |
| 批大小 | 10 条/批 | 减少 API 调用 |
| 阈值 | `intent_score > 0.7` 才入 CRM | 调高减少噪音 |
| 月成本 | ~120 元（OpenAI）/ ~15 元（DeepSeek）| |

**错误处理**：LLM 返回非 JSON → 正则抢救 + 失败时该批次不入库；API 限流 → 退避 + 重试；单条失败不影响整批。

**测试**：准备 30 条人工标注样本，准确率 > 80%。

---

### 3.4 模块 4：RAG 知识库 + 钩子生成器

**目的**：让 LLM 写钩子话术时，能引用**业务方在 `business/knowledge/` 中提供的真实案例 / 方法论 / FAQ**——所有"业务相关"内容均来自 `business/profile.yaml` + `business/knowledge/`，与 §3.3 一致地**模板化**。

**目录结构**（位于 `business/knowledge/` 下，由业务方自由组织）：
```
business/knowledge/
├── 01-cases/         # 业务真实案例（数量与命名由业务方决定）
├── 02-methodology/   # 业务方法论 / 流程
├── 03-hooks/         # 历史高转化话术模板
└── 04-faq/           # 常见问题应对
```

> **关于子目录命名**：上述 4 个子目录是**默认推荐结构**，框架的检索逻辑**不依赖**具体目录名——它对 `business/knowledge/` 下所有 `.md` 文件做扁平检索（参见 §13.4.5 Embedding Provider）。业务方可以重命名、合并、增加子目录。

**MVP 阶段 6-8 个 markdown 即可上线**（2-3 案例 + 1 方法论 + 2-3 话术 + 1-2 FAQ），后续可逐步扩充到 15-25 个。

**文件**：
- `business/knowledge/`（业务方维护，4 类文档，MVP 6-8 个 markdown）
- `src/rag/build-index.ts`（建索引）
- `src/rag/retrieve.ts`（检索）
- `src/rag/generate-hook.ts`（生成）

**技术栈**：

| 组件 | 选择 | 成本 |
|---|---|---|
| Embedding | `text-embedding-3-small`（或 `bge-small-zh` 本地免费版） | 一次性 ~0.05 元 |
| 向量库 | SQLite + sqlite-vec | 0 |
| 切分 | 整文件不切 | 0 |
| 检索 | top-3 余弦相似度 | 0 |

**核心生成逻辑**：
```typescript
async function generateHook(
  profile: BusinessProfile,  // 注入业务画像（替换所有硬编码的"燃点 FDE"）
  lead: Lead,
  hookType: 'reply' | 'dm'
) {
  // 1. 检索 top-3 文档
  const queryEmbedding = await embed(`${lead.persona} ${lead.pain_point}`);
  const docs = retrieveTopK(queryEmbedding, 3);

  // 2. 🆕 读取反馈分析器的最新 insights，获取最优钩子风格
  //    闭环：§3.11 分析结果 → 写入 weekly-insights.json → 本函数读取 → 影响生成
  const insights = await loadLatestInsights(profile.business.name);  // 读 data/feedback/weekly-insights.json
  const bestStyle = insights?.hook_style_performance
    ?.sort((a, b) => b.rate - a.rate)[0]?.style;  // 取回复率最高的风格
  const hookStyle = bestStyle ?? profile.hook_config.style ?? '像朋友推荐，不像销售';

  // 3. 组装 prompt（含知识库内容 + 业务画像 + 反馈驱动的最优风格）
  const prompt = `
你是「${profile.business.name}」的获客写手，写${hookType === 'reply' ? '评论回复' : '私信开头'}。

【${profile.business.name} 的真实知识库（可引用）】
${docs.map(d => `> ${d.path}\n${d.content}`).join('\n\n')}

【客户画像】
${JSON.stringify(lead, null, 2)}

【要求】
1. 不超过 ${profile.hook_config.max_length ?? 30} 字
2. 必须引用一个具体案例/数字/方法
3. 结尾有钩子（让对方想回复）
4. 风格：${hookStyle}
5. 输出语言：${profile.hook_config.language ?? '中文'}

直接输出话术：
  `;

  const result = await llm.complete(prompt);

  // 4. 🆕 记录本次使用的风格到 Lead 接口正式字段，供 §3.11 A/B 归因
  //    闭环：生成时记录风格 → CRM 同步时持久化 → lead 状态变化时写入事件 → §3.11 分析风格效果
  lead.hook_style = hookStyle;

  return result;
}
```

**关键设计点**：
- **业务名**、**知识库路径**、**字数限制**、**风格**、**语言**——**全部**来自 `profile.yaml`，**零硬编码**
- 与 §3.3 意图分析器保持**同一套模板化机制**（`{{ business.name }}` + 业务方提供的 prompt 模板）
- 业务方可以进一步在 `business/prompts/hook-reply.md` / `hook-dm.md` 中**完全自定义**整个 prompt 模板（不只填字段）；若自定义模板存在则优先使用

**错误处理**：检索无结果 → 退化为通用 prompt（只用业务画像，不引用知识库）；LLM 输出过长 → 截断到 `profile.hook_config.max_length` 字；markdown 解析失败 → 跳过该文件。

**测试**：准备 20 个 lead，评估生成钩子的人工打分 > 4/5。

---

### 3.5 模块 5：CRM Adapter

**目的**：把 Lead 同步到用户自选的 CRM。**不再写死飞书**。

| 项目 | 详情 |
|---|---|
| 接口定义 | `src/adapters/crm/base.ts` |
| 飞书实现 | `src/adapters/crm/feishu.ts` |
| Notion 实现 | `src/adapters/crm/notion.ts` |
| Airtable 实现 | `src/adapters/crm/airtable.ts` |
| 本地 CSV 实现 | `src/adapters/crm/csv.ts`（开发用、零配置）|

**接口**：
```typescript
interface CRMAdapter {
  syncLeads(leads: Lead[]): Promise<SyncResult>;
  getLead(cid: string): Promise<Lead | null>;
  updateStatus(cid: string, status: LeadStatus): Promise<void>;
  listLeads(filter?: LeadFilter): Promise<Lead[]>;
}
```

**用户配置**（`business/crm.yaml`）——以下为**默认示例业务「燃点 FDE」**的配置（业务方使用自己的 CRM 时，**必须**修改 `type` / `app_id` / `table_id` / `field_mapping`）：
```yaml
# ===== 以下为示例：燃点 FDE 用飞书多维表 =====
crm:
  type: feishu     # 可选: feishu | notion | airtable | csv | custom
  config:
    app_id: "cli_xxx"
    app_secret_env: FEISHU_APP_SECRET
    table_id: "FDE意向客户池"  # ← 替换为：你的 CRM 表标识
    field_mapping:
      nickname: "抖音昵称"
      comment: "评论原文"
      video_url: "视频链接"
      pain_point: "痛点"
      persona: "人设"
      intent_score: "intent_score"
      hook_reply: "钩子_评论用"
      hook_dm: "钩子_私信用"
      status: "状态"
      today_task: "今日任务"
      created_at: "创建时间"
      last_interaction: "最后互动"
      notes: "备注"
```

**用户自选 CRM 流程**：
```bash
# 1. 复制示例
npx explore-star init my-business

# 2. 改 crm.yaml 一行
vim my-business/crm.yaml    # type: notion

# 3. 跑起来
npx explore-star run --business=./my-business
```

**标准字段映射**（所有 CRM 实现都支持）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `nickname` | 文本 | 抖音昵称 |
| `comment` | 文本 | 评论原文 |
| `video_url` | URL | 视频链接 |
| `pain_point` | 文本 | 痛点 |
| `persona` | 单选 | 由 profile 决定选项 |
| `intent_score` | 数字 | |
| `hook_reply` | 文本 | 评论回复钩子 |
| `hook_dm` | 文本 | 私信钩子 |
| `hook_style` | 单选 | 🆕 本次使用的钩子风格（供 §3.11 A/B 归因）|
| `source_keyword` | 文本 | 🆕 触发该 lead 的关键词（供 §3.11 关键词归因）|
| `source_video_id` | 文本 | 🆕 来源视频 ID |
| `status` | 单选 | LeadStatus 枚举值（§13.4.1，支持业务方自定义扩展）|
| `opt_out` | 复选框 | 🆕 用户明确拒绝（true 时停止所有后续任务）|
| `last_task_executed_at` | 日期 | 🆕 上次执行任务时间（24h 冷却期依赖）|
| `last_task_result` | 单选 | 🆕 有回应 / 无回应 / 被拒 / 执行失败 |
| `last_response_text` | 多行文本 | 🆕 对方回复内容（opt_out 检测 + LLM 分析依赖）|
| `execution_count` | 数字 | 🆕 累计执行次数（智能放弃判定依赖）|
| `response_count` | 数字 | 🆕 累计回应次数 |
| `today_task` | 文本 | |
| `created_at` | 日期 | |
| `last_interaction` | 日期 | |
| `notes` | 多行文本 | |

**错误处理**：CRM API 限流 → 退避 1 秒；单条失败 → 记录到 `data/failed-sync.json`；Token 过期 → 自动刷新。

---

### 3.6 模块 6：引导引擎（任务编排 + 自动执行 + 互动感知）

**目的**：根据客户状态 + 时间 + **真实互动效果** 自动生成并执行每日引导任务。**全部自动**——登录态浏览器执行，限速 + 真人节律保障安全。

| 项目 | 详情 |
|---|---|
| 文件 | `src/modules/nurture-engine/index.ts` |

**核心状态机**：

```
新发现 (D0)
  ↓ [任务1: 点赞+关注]
已关注 (D0-D1)
  ↓ [任务2: 评论回复]
已互动 (D1-D3)
  ↓ [对方回复 / 视频下互动]
可加好友 (D3-D5)
  ↓ [任务3: 好友申请]
已加好友 (D5+)
  ↓ [对方接受]
可私信 (D5+)
  ↓ [任务4: 私信 + 发 PDF]
已私信 (D7+)
  ↓ [引导加微信 / 预约]
已加微 / 已预约 (D10+)
  ↓
[进入 §3.10 转化引擎]
  - 推送预约表单
  - 监听预约事件
  - 转化日报统计
  ↓
已成交 / 已流失
```

#### 3.6.1 任务生成（基础 + 反馈驱动）

**Task 接口**：
```typescript
interface Task {
  task_id: string;              // UUID
  lead_cid: string;             // 关联的 lead（CRM 中的 cid）
  nickname: string;             // 抖音昵称（用于通知展示）
  current_state: LeadStatus;    // 当前状态
  next_action: TaskAction;      // 下一步动作
  hook: string;                 // 话术文本（§3.4 生成）
  hook_style: string;           // 本次使用的钩子风格
  priority: 'high' | 'medium' | 'low';
  persona: string;              // 目标人设 ID
  scheduled_at: string;         // ISO 8601，计划执行时间
  reason: string;               // 调度理由（用于通知展示）
  // 以下字段由 task-executor 回填
  executed_at?: string;         // 实际执行时间
  execution_result?: TaskResult; // 执行结果
  risk_signal?: RiskSignal;     // 风控信号（如有）
}

type TaskAction =
  | 'like_and_follow'           // 点赞 + 关注
  | 'comment_reply'             // 评论回复
  | 'friend_request'            // 好友申请
  | 'dm'                        // 私信
  | 'send_material';            // 推送物料（加微后）

type TaskResult =
  | 'executed_with_response'    // 已执行，对方有回应
  | 'executed_no_response'      // 已执行，对方无回应
  | 'rejected'                  // 被对方拒绝
  | 'failed_risk'               // 风控失败
  | 'failed_network'            // 网络错误
  | 'skipped';                  // 跳过（紧急停止 / 审核未通过）
```

**状态转移表**（buildTask 的核心逻辑——根据 lead.current_state 决定 next_action）：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  状态转移表                                                                  │
│                                                                              │
│  current_state      → next_action        → new_state     → 条件              │
│  ──────────────────────────────────────────────────────────────────────────  │
│  新发现              → like_and_follow    → 已关注        → 无条件            │
│  已关注              → comment_reply      → 已互动        → 距上次任务 ≥ 24h  │
│  已互动              → friend_request     → 已加好友      → 对方有回应        │
│  已互动              → (等待)             → 已互动        → 对方无回应，重试 1 次后降级 │
│  已加好友            → dm                 → 已私信        → 对方接受好友申请  │
│  已私信              → send_material      → 已加微        → 引导加微信        │
│  已加微              → (进入转化引擎)     → —             → §3.10 接管        │
│  ──────────────────────────────────────────────────────────────────────────  │
│  以下为降级/终止条件：                                                        │
│  已互动 (3 次无回应)  → —                  → 已流失        → 智能放弃判定 §3.6.3 │
│  已加好友 (被拒)      → —                  → 已流失        → 立即降级          │
│  任意状态 (opt_out)   → —                  → 已流失        → 用户明确拒绝      │
│  已加微 (30 天无预约) → —                  → 再激活池      → §3.6.4            │
│  任意状态 (60 天无动作)→ —                 → 永久归档      → 超时清理          │
└─────────────────────────────────────────────────────────────────────────────┘
```

**buildTask 函数定义**：

```typescript
/**
 * 根据 lead 当前状态 + 转移表，决定下一步任务
 * @returns Task 或 null（该 lead 今天没有可执行的任务）
 */
function buildTask(lead: Lead, profile: BusinessProfile): Task | null {
  // 0. 前置检查
  if (lead.opt_out) return null;                    // 用户已拒绝
  if (lead.status === '已流失') return null;        // 已流失
  if (lead.status === '已成交') return null;        // 已成交
  if (lead.status === '已加微') return null;        // 交给 §3.10 转化引擎

  // 1. 检查 24h 冷却期
  if (lead.last_task_executed_at) {
    const hoursSinceLastTask = (Date.now() - new Date(lead.last_task_executed_at).getTime()) / 3600000;
    if (hoursSinceLastTask < 24) return null;        // 未到 24h，跳过
  }

  // 2. 状态转移
  const transition = STATE_TRANSITIONS[lead.status];
  if (!transition) return null;                     // 无转移规则

  // 3. 检查转移条件
  if (transition.condition && !transition.condition(lead)) return null;

  // 4. 生成钩子
  const hook = await generateHook(profile, lead, transition.hookType);

  // 5. 构建任务
  return {
    task_id: uuid(),
    lead_cid: lead.cid,
    nickname: lead.nickname,
    current_state: lead.status,
    next_action: transition.action,
    hook,
    hook_style: lead.hook_style,
    priority: lead.intent_score > 0.85 ? 'high' : lead.intent_score > 0.7 ? 'medium' : 'low',
    persona: lead.persona,
    scheduled_at: '',  // 由 generateDailyTasks 填充
    reason: `状态 ${lead.status} → ${transition.new_state}`,
  };
}

// 状态转移规则表
const STATE_TRANSITIONS: Record<string, Transition> = {
  '新发现': {
    action: 'like_and_follow',
    new_state: '已关注',
    hookType: null,  // 点赞+关注不需要话术
    condition: null,
  },
  '已关注': {
    action: 'comment_reply',
    new_state: '已互动',
    hookType: 'reply',
    condition: null,
  },
  '已互动': {
    action: 'friend_request',
    new_state: '已加好友',
    hookType: null,  // 好友申请不需要话术
    condition: (lead) => lead.last_task_result === 'executed_with_response',
  },
  '已加好友': {
    action: 'dm',
    new_state: '已私信',
    hookType: 'dm',
    condition: null,
  },
  '已私信': {
    action: 'send_material',
    new_state: '已加微',
    hookType: null,  // 物料内容由 conversion.yaml 决定
    condition: null,
  },
};

interface Transition {
  action: TaskAction;
  new_state: string;
  hookType: 'reply' | 'dm' | null;
  condition: ((lead: Lead) => boolean) | null;
}
```

**任务生成逻辑**（含 2 条反馈回路）：

```typescript
async function generateDailyTasks(profile: BusinessProfile): Promise<Task[]> {
  // 1. 从 CRM 读取所有非终态 lead（排除已流失/已成交/已加微/opt_out）
  const leads = await crm.listLeads({
    status_not_in: ['已流失', '已成交', '已加微', '已再激活'],
    opt_out: false,
  });

  // 2. 🆕 读取反馈分析器的 persona 价值排序，按 value_score 降序排列
  const insights = await loadLatestInsights(profile.business.name);
  const personaScores = new Map(
    (insights?.persona_value ?? []).map(p => [p.persona, p.value_score])
  );
  leads.sort((a, b) => {
    const scoreA = personaScores.get(a.persona) ?? 5.0;
    const scoreB = personaScores.get(b.persona) ?? 5.0;
    return scoreB - scoreA;
  });

  // 3. 🆕 按 persona 的最佳互动时段安排推送时间
  const bestTimes = insights?.best_interaction_times ?? {};
  const tasks: Task[] = [];
  for (const lead of leads) {
    if (tasks.length >= 20) break;  // 每天最多 20 条
    const task = buildTask(lead, profile);
    if (task) {
      task.scheduled_at = pickBestTime(bestTimes[lead.persona]);
      tasks.push(task);
    }
  }

  return tasks;
}
```

**每日输出**（任务按最佳时段分批推送，而非统一 09:30）：
```json
{
  "date": "2026-06-01",
  "tasks": [
    {
      "lead_cid": "comment_xxx",
      "nickname": "电商小张",
      "current_state": "新发现",
      "next_action": "评论回复",
      "hook": "我们刚给杭州一家 MCN 做了自动字幕...",
      "hook_style": "朋友推荐",
      "priority": "high",
      "persona": "ecommerce",
      "scheduled_at": "2026-06-01T10:00:00+08:00",
      "reason": "电商 persona 最佳时段 工作日 09:00-11:00"
    }
  ]
}
```

#### 3.6.2 🆕 互动效果感知

**问题**：任务自动执行后，**系统需要知道对方有没有回应**，才能决定下一步。

**解决**：系统自动检测执行结果，**引擎自动决定下一步**：

| 系统检测到的结果 | 引擎自动行为 |
|---|---|
| ✅ 任务已执行，对方有回应（评论回复 / 私信回复） | 推进到下一阶段（生成新任务）|
| ✅ 任务已执行，对方无回应 | 24h 后重试一次，再无回应就降级 |
| ❌ 任务被对方拒绝（如好友申请被拒）| 立即降级为「已流失」 |
| ❌ 任务执行失败（风控 / 滑块 / 网络错误）| 暂停该类型任务 1h，记录日志 |

**结果自动检测机制**：

| 检测方式 | 适用场景 | 实现 |
|---|---|---|
| 评论回复监听 | 评论回复任务 | 执行后 24h 内重新抓该视频评论，检查对方是否回复 |
| 私信回复监听 | 私信任务 | 登录态浏览器检查私信列表，是否有新回复 |
| 好友申请结果 | 好友申请任务 | 登录态浏览器检查好友申请列表，是否被接受/拒绝 |
| 执行状态码 | 所有任务 | 浏览器操作返回成功/失败/风控信号 |

**互动效果反馈数据结构**（CRM 多维表新增字段）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `last_task_executed_at` | 日期 | 上次执行任务的时间 |
| `last_task_result` | 单选 | 有回应 / 无回应 / 被拒 / 执行失败 |
| `last_response_text` | 文本 | 对方回复内容（AI 用来分析）|
| `execution_count` | 数字 | 累计执行了几次任务 |
| `response_count` | 数字 | 累计有几次回应 |

#### 3.6.3 🆕 智能放弃判定

**问题**：7 天无进展就降级太粗暴——很多客户确实需要 30 天才决定。

**解决**：动态放弃判定：

| 条件 | 行为 |
|---|---|
| 执行任务 ≥ 3 次 + 0 回应 | 标记「已流失」 |
| 已加微 30 天 + 未预约 | 转入「再激活池」 |
| 超过 60 天无任何动作 | 永久归档 |
| 显式拒绝（"不需要" / "别发了"）| 立即标记「已流失」+ `opt_out: true` |

**opt_out 检测机制**：
```typescript
// 互动效果回填时，检查回复内容是否包含拒绝信号
const REJECT_SIGNALS = ['不需要', '别发了', '别再发', '拉黑', '不要', '没兴趣', '不用了', 'stop', 'unsubscribe'];

function checkOptOut(responseText: string): boolean {
  if (!responseText) return false;
  return REJECT_SIGNALS.some(signal => responseText.includes(signal));
}

// 在 §3.6.2 互动效果回填流程中调用
if (result.response_text && checkOptOut(result.response_text)) {
  lead.opt_out = true;
  lead.status = '已流失';
  await crm.updateStatus(lead.cid, '已流失');
  await crm.updateField(lead.cid, 'opt_out', true);
}
```

#### 3.6.4 🆕 再激活队列

**问题**：30 天前加过微的客户，可能现在又有需求了。

**解决**：沉默客户进入「再激活池」，每月 1 日自动尝试一次轻量触达（接入 §3.10 转化引擎的再激活功能）。

**任务安全规则**：

| 规则 | 值 | 理由 |
|---|---|---|
| 每天最多生成任务 | 20 条 | 避免过度打扰 |
| 同一客户两次任务间隔 | ≥ 24 小时 | 像真人节奏 |
| 同一客户执行 3 次 0 回应 | 降级为"已流失" | 减少无效任务 |
| 同一账号每天好友申请 | ≤ 5 个 | 抖音风控 |
| 同一账号每天私信 | ≤ 10 个 | 抖音风控 |
| 每月再激活尝试 | 1 次 | 不骚扰 |

#### 3.6.5 🆕 自动执行引擎

**目的**：用登录态浏览器自动执行引导任务，替代人工操作。

**文件**：`src/modules/task-executor/index.ts`

**接口定义**：
```typescript
interface ExecutionResult {
  task_id: string;
  lead_cid: string;
  action: TaskAction;
  result: TaskResult;           // Task 接口中定义的枚举
  executed_at: string;          // ISO 8601
  response_text?: string;       // 对方回复内容（如有）
  risk_signal?: RiskSignal;    // 风控信号（如有）
  error_message?: string;       // 错误信息（如有）
}

interface RiskSignal {
  type: 'slider' | 'rate_limit' | 'ip_switch' | 'account_ban' | 'captcha';
  count: number;                // 该类型信号累计次数
  action: 'pause_1h' | 'stop_today' | 'emergency_stop';
}

interface SafetyConfig {
  rate_limits: {
    douyin: {
      search_per_hour: number;
      comment_per_hour: number;
      friend_request_per_day: number;
      dm_per_day: number;
    };
    min_interval_seconds: number;
    max_interval_seconds: number;
  };
  daily_budget: {
    tasks: number;              // 每天最多执行任务数
    engagement_actions: number; // 每天最多互动动作数
  };
  hook_review: boolean;         // 钩子审核模式（默认 true：前 2 周建议开启，稳定后关闭）
}

/**
 * 通过登录态浏览器执行单个任务
 * @param task - 待执行的任务
 * @param chromeProfile - Chrome Profile 路径（登录态）
 * @returns 执行结果
 */
async function browserExecute(
  task: Task,
  chromeProfile: string
): Promise<ExecutionResult>
```

**执行流程**：
```typescript
async function executeTasks(tasks: Task[], config: SafetyConfig): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  for (const task of tasks) {
    // 1. 检查紧急停止开关
    if (fs.existsSync('config/EMERGENCY_STOP')) {
      throw new Error('紧急停止开关已启用，终止执行');
    }

    // 2. 按 scheduled_at 等待到最佳执行时间
    await waitUntil(task.scheduled_at);

    // 3. 执行前随机延迟（真人节律）
    await sleep(randomBetween(config.min_interval_seconds, config.max_interval_seconds) * 1000);

    // 4. 通过登录态浏览器执行
    const result = await browserExecute(task);

    // 5. 记录执行结果
    results.push(result);

    // 6. 风控信号检测
    if (result.risk_signal) {
      await handleRiskSignal(result.risk_signal);
      break;  // 停止后续任务
    }

    // 7. 回填 CRM
    await crm.updateStatus(task.lead_cid, result.new_status);
    if (result.response_text) {
      await crm.updateField(task.lead_cid, 'last_response_text', result.response_text);
    }
  }
  return results;
}
```

**浏览器执行映射**（每种任务类型对应具体的浏览器操作）：

| 任务类型 | 浏览器操作 | 限速 |
|---|---|---|
| 点赞 + 关注 | 打开视频页 → 点赞按钮 → 关注按钮 | 3-8 秒间隔 |
| 评论回复 | 打开视频页 → 找到评论 → 输入 hook 文本 → 发送 | 3-8 秒间隔 |
| 好友申请 | 打开用户主页 → 点击「关注」（触发好友申请） | 每天 ≤ 5 个 |
| 私信 | 打开用户主页 → 私信入口 → 输入 hook 文本 → 发送 | 每天 ≤ 10 个 |

**可选：钩子审核模式**（`config.yaml → hook_review: true`）：
```bash
# 开启后，每天 09:00 先推送到微信/飞书，人审核后再执行
# 审核方式：在飞书多维表里勾选「批准」/「修改」/「跳过」
# 10:00 自动执行已批准的任务
```
适用于：对钩子质量不放心的前 2 周，或高客单价业务需要精细话术的场景。稳定后可关闭。

**测试**：50 个 mock lead 跑 30 天模拟，验证状态机推进 + 互动感知 + 放弃判定都正确。

---

### 3.7 模块 7：编排器 + 通知

**目的**：把所有模块串起来，定时跑（侦察 → 分析 → 生成任务 → **自动执行** → 通知）。

**文件**：
- `run-daily.sh`（编排脚本）
- `notify/wechat.ts`（微信通知）
- `notify/feishu.ts`（飞书通知）

**每日流程**（`run-daily.sh`）——**v1.4 真实流程**（基于本地 opencli 源码的 `search` + `user-videos --with_comments`）：
```bash
#!/bin/bash
set -e
cd "$(dirname "$0")"
BUSINESS_DIR="${BUSINESS_DIR:-./business.example/燃点-FDE}"
DATE=$(date +%Y-%m-%d)
LOG="logs/${DATE}.log"
mkdir -p logs data/tmp

echo "[$(date)] 探星启动" | tee -a "$LOG"

# 读取 source.mode（默认 sec_uid）
MODE=$(yq '.source.mode // "sec_uid"' "${BUSINESS_DIR}/channels.yaml")
echo "[$(date)] 数据源模式: ${MODE}" | tee -a "$LOG"

# ① 侦察阶段：拉视频 + 评论（按 source.mode 走两条路径之一）
> data/tmp/raw-${DATE}.jsonl

if [ "$MODE" = "sec_uid" ] || [ "$MODE" = "both" ]; then
  # 路径 A（V1 推荐）：按目标 KOL 拉视频+评论
  USER_LIMIT=$(yq '.target_sec_uids.user_videos_limit // 20' "${BUSINESS_DIR}/channels.yaml")
  COMMENT_LIMIT=$(yq '.target_sec_uids.comment_limit // 10' "${BUSINESS_DIR}/channels.yaml")
  SEC_UIDS=$(yq -o=csv -I=0 '.target_sec_uids[]' "${BUSINESS_DIR}/channels.yaml" | tr -d '"' | head -10)
  for sec_uid in $SEC_UIDS; do
    [ -z "$sec_uid" ] && continue
    echo "[$(date)] 拉 KOL ${sec_uid} 的视频+评论" | tee -a "$LOG"
    opencli douyin user-videos "$sec_uid" \
      --limit "$USER_LIMIT" \
      --with_comments true \
      --comment_limit "$COMMENT_LIMIT" \
      --format json \
      >> data/tmp/raw-${DATE}.jsonl || echo "[WARN] KOL ${sec_uid} 失败" | tee -a "$LOG"
    sleep $((RANDOM % 5 + 3))s
  done
fi

if [ "$MODE" = "keyword" ] || [ "$MODE" = "both" ]; then
  # 路径 B（V1 备选）：按关键词搜视频（评论=0，需二次调用）
  for kw in $(yq '.search.keywords | keys | .[]' "${BUSINESS_DIR}/channels.yaml" | head -5); do
    [ -z "$kw" ] && continue
    echo "[$(date)] 搜索关键词: ${kw}" | tee -a "$LOG"
    opencli douyin search "$kw" --limit 10 --format json \
      >> data/tmp/raw-${DATE}.jsonl || echo "[WARN] 关键词 ${kw} 失败" | tee -a "$LOG"
    sleep $((RANDOM % 5 + 3))s
  done
fi

# ② 标准化为统一 Comment[] schema（处理两路径的输出差异）
node dist/normalize.js \
  --input data/tmp/raw-${DATE}.jsonl \
  --output data/tmp/comments-${DATE}.json

# ③ 预处理：去重/去 emoji/去营销号/过滤 min_likes/过滤 max_age_days
node scripts/filter-comments.js \
  --input data/tmp/comments-${DATE}.json \
  --output data/tmp/comments-filtered-${DATE}.json \
  --config "${BUSINESS_DIR}/channels.yaml"

# ④ LLM 意图分析
node dist/intent.js \
  --input data/tmp/comments-filtered-${DATE}.json \
  --output data/tmp/leads-${DATE}.json \
  --threshold 0.7 \
  --business "${BUSINESS_DIR}"

# ⑤ 同步 CRM（CRM 类型 / table-id / 字段映射 全部从 business/crm.yaml 读取）
node dist/crm-sync.js \
  --input data/tmp/leads-${DATE}.json \
  --config "${BUSINESS_DIR}/crm.yaml"

# ⑥ 引导任务生成（不自动执行——人执行）
node dist/nurture.js \
  --output data/tmp/tasks-${DATE}.json \
  --business "${BUSINESS_DIR}"

# ⑦ 通知（早报 + 任务清单）
node dist/notify.js \
  --tasks data/tmp/tasks-${DATE}.json \
  --report "logs/${DATE}.md" \
  --business "${BUSINESS_DIR}"
```

**Cron 配置**（完整清单——7 个定时任务）：
```bash
# ① 早 09:00 主流程（侦察 + 分析 + 生成任务 + 自动执行 + 早报通知）
0 9 * * * /Users/lylyyds/Desktop/explore-star/run-daily.sh

# ② 晚 18:00 推送晚报（今日互动统计 + 明日预览）
0 18 * * * cd /Users/lylyyds/Desktop/explore-star && node dist/daily-report.js

# ③ 晚 22:00 推送转化日报（漏斗/营收/ROI/Hot Leads/At Risk）
0 22 * * * cd /Users/lylyyds/Desktop/explore-star && node dist/conversion-report.js

# ④ 每 6h 健康检查（今日是否成功/磁盘/cron 存活）
0 */6 * * * /Users/lylyyds/Desktop/explore-star/health-check.sh

# ⑤ 每周日凌晨 03:00 反馈分析（关键词归因/钩子风格/persona 价值/互动时段）
0 3 * * 0 cd /Users/lylyyds/Desktop/explore-star && node dist/analyze-feedback.js

# ⑥ 每周一 09:00 推送优化建议（含 5 条回路的调优结果）
0 9 * * 1 cd /Users/lylyyds/Desktop/explore-star && node dist/optimization-report.js

# ⑦ 每月 1 日 10:00 沉默客户再激活（30 天无互动的已加微 lead）
0 10 1 * * cd /Users/lylyyds/Desktop/explore-star && node dist/reactivate.js
```

**早 09:30 推送**：
```
✨ 探星早报 2026-06-01

📊 今日扫描：50 视频 / 4823 评论 / 87 高意向

🎯 今日任务 8 条（自动执行中）：
  1. @电商小张 [评论回复] 钩子："我们刚给杭州一家..." ⏳ 10:00 执行
  2. @跨境老王 [好友申请] 钩子："王哥，看到你评论问 AI 客服..." ⏳ 10:05 执行

🔒 安全状态：正常（今日已执行 0/20，好友 0/5，私信 0/10）
📋 钩子审核：已关闭（自动执行）

👉 打开飞书查看详情：http://feishu.xxx/explore-star/today
```

**晚 18:00 推送**：
```
📈 探星晚报 2026-06-01

[今日数据] 新增 87 / 互动 8 / 加微 2 / 预约 1
[明日 Top 3 预览] @小张（已加微）/ @老王（已私信）/ @李姐（已互动）
[本周累计] 412 意向 / 23 加微 / 5 预约 / 2 成交
```

---

### 3.8 模块 8：LLM Provider Adapter

> 详细接口规范见 **§13.4.2 附录**。
>
> 简言之：`LLMProvider` 接口在 `src/adapters/llm/base.ts`，内置 4 个实现（OpenAI / DeepSeek / Anthropic / Ollama），用户通过 `business/profile.yaml` 的 `llm:` 字段选择。API Key 从环境变量读。

---

### 3.9 模块 9：Channel Adapter（平台抽象，V2 扩展点）

> 详细接口规范见 **§13.4.3 附录**。
>
> 简言之：`ChannelAdapter` 接口在 `src/adapters/channel/base.ts`，V1 仅 `DouyinChannel`（内部组合 §3.1 / §3.2 的两个 OpenCLI 命令）。V2 用户可实现 `XiaohongshuChannel` / `BilibiliChannel` 等，放到 `business/adapters/channel/` 目录，启动时自动加载。

---

### 3.10 模块 10：**转化引擎（Conversion Engine）** —— 核心！

> **这是设计 v1.2 的核心新增**——把"加微"到"成交"这段真正自动化（**注意**：关键动作仍由人工执行，详见 §1.3；本模块负责**自动决策 + 推送 + 监听**）。

**目的**：让探星不仅"加微"，还能推动客户进入**业务方在 `business/conversion.yaml` 中定义的下一步**（如：预约诊断 / 申请试用 / 填写需求表 / 购买课程 / 等等）。

**子功能矩阵**：

| 子功能 | 触发时机 | 实现 |
|---|---|---|
| **获客物料推送** | 客户加微后 24h 内 | 微信发送 `business/conversion.yaml → post_add_asset` 指定的物料（PDF / 资料包 / 体验链接） + `booking_url` 指定的转化入口 |
| **预约监听** | 实时 | `BookingProvider` adapter 监听新预约事件（飞书日历 / 落地页 WebHook / 微信客服 / 其他）→ 自动更新 lead 状态 |
| **转化日报** | 每天 22:00 | 微信推送「📈 探星转化日报」 |
| **ROI 计算** | 每天 + 每周 | 探星成本 vs 探星带来的预估营收 |
| **沉默客户再激活** | 30 天无互动 | 自动推送一次轻量触达（话术由 §3.4 钩子生成器 + RAG 生成）|
| **客户全生命周期** | 持续 | 状态机由 `business/conversion.yaml → lifecycle_states` 定义，**不再硬编码**。默认提供：已加微 → 已接触 → 已成交（业务方可扩展为：已加微 → 已预约 → 已诊断 → 已成交 → 续约 等任意流程） |

**核心接口**：
```typescript
interface ConversionEngine {
  // 客户加微后立即触发
  onLeadAddedWechat(cid: string): Promise<ConversionAction[]>;

  // 监听预约事件（飞书日历）
  watchBookings(): Promise<void>;

  // 每天 22:00 跑一次
  generateDailyReport(): Promise<ConversionReport>;

  // 沉默客户再激活
  findDormantLeads(): Promise<Lead[]>;
  reactivateLead(cid: string): Promise<void>;

  // 🆕 全链路事件记录（闭环：每次触达/物料推送都写入事件，供 §3.11 归因）
  recordTouchpoint(cid: string, touchpoint: TouchpointEvent): Promise<void>;
}

interface ConversionAction {
  type: 'send_pdf' | 'send_booking_link' | 'send_followup';
  channel: 'wechat' | 'feishu' | 'email';
  payload: { ... };
  scheduled_at: Date;
  // 🆕 每个 action 带唯一 ID，供后续归因
  action_id: string;
}

// 🆕 转化路径触达事件（闭环：§3.10 记录 → §3.11 读取 → 分析哪条物料/哪次触达促成转化）
interface TouchpointEvent {
  cid: string;
  action_id: string;          // 关联 ConversionAction
  action_type: 'send_pdf' | 'send_booking_link' | 'send_followup' | 'reactivate';
  channel: 'wechat' | 'feishu' | 'email';
  content_summary: string;    // 推送内容摘要（如 PDF 名 / 话术前 20 字）
  sent_at: string;            // ISO 8601
  result?: 'opened' | 'replied' | 'booked' | 'no_response';  // 后续回填
  result_at?: string;         // 结果发生时间
}

interface ConversionReport {
  date: string;
  // 当日
  new_leads: number;
  new_wechat_added: number;
  new_bookings: number;
  new_diagnosis_done: number;
  new_deals_closed: number;
  revenue_today: number;
  // 本周
  weekly_revenue: number;
  // ROI
  cost_today: number;
  roi_today: number;        // revenue / cost
  // Top 客户
  hot_leads: Lead[];        // 即将成交
  at_risk_leads: Lead[];    // 可能流失
  // 🆕 全链路转化率（闭环：转化日报展示各环节转化率，不再只有"加微率"）
  funnel_detail: {
    stage: string;            // lifecycle_states 中的每个状态
    count: number;
    avg_days_in_stage: number; // 在该阶段平均停留天数
    top_touchpoint: string;   // 促成该阶段转化的最有效触达方式
  }[];
}
```

**转化日报**（22:00 推送）：
```
📈 探星转化日报 2026-06-01

[今日转化漏斗]
新发现：87 → 已互动：8 → 加微：2 → 预约：1 → 成交：0

[今日营收] ¥0
[本周累计] ¥50,000（2 个成交）
[本月累计] ¥180,000（4 个成交）

[ROI 分析]
探星月成本：¥450
探星本月带来营收：¥180,000
ROI：400x

[Hot Leads] 即将成交
- @小张（已预约，6/2 下午 3 点诊断）
- @王姐（已加微，回复了"在考虑"）

[At Risk] 可能流失
- @老李（加微 5 天未回复）
- @小陈（加微 14 天未激活）

👉 打开飞书查看：http://feishu.xxx/explore-star/conversion
```

**沉默客户再激活**（30 天无互动）：
```
1. 30 天前的「已加微」但未「已成交」lead
2. 自动生成一条轻量话术（AI）
3. 通过微信发：「X 总，上次说的 AI 方案，还在考虑吗？
   如果有新的想法，我可以帮你重新评估。」
4. 标记为「已再激活」，再等 7 天无回应就标记「已流失」
```

**CLI**：
```bash
# 手动触发转化日报
npx explore-star conversion-report --business=./my-business

# 手动激活沉默客户
npx explore-star reactivate --business=./my-business --cid=comment_xxx

# 监听预约（生产环境常驻）
npx explore-star watch-bookings --business=./my-business
```

**关键设计**：
- 转化是**业务相关**的，所以 4 个子功能都从 `profile.yaml` + `conversion.yaml` 读配置
- 推送内容（PDF / 话术）走 §3.4 钩子生成器（用 RAG + 业务案例）
- 预约监听用飞书日历 WebHook，V2 抽象为 `BookingProvider` adapter

#### 3.10.1 触达结果回填机制

**TouchpointEvent.result 追踪逻辑**——每次触达后，系统自动监听结果并回填：

| result 值 | 触发条件 | 数据来源 |
|---|---|---|
| `opened` | 物料链接被点击 | 短链服务（如 s.click.taobao.com）的点击回调；或微信消息已读回执（V2）；或手动标记 |
| `replied` | 客户回复了私信 | CRM 中 `last_response_text` 字段非空 → 自动回填 |
| `booked` | 客户预约了 | §3.10 BookingProvider 监听到新预约事件 → 自动回填关联的 touchpoint |
| `no_response` | 触达后 7 天无任何动作 | 定时任务扫描：`sent_at` 超过 7 天且 result 仍为空 → 自动标记 |

**回填流程**：
```
触达事件写入 events.jsonl（result 为空）
  ↓
后台监听器持续检查：
  - CRM last_response_text 变化 → 回填 'replied'
  - BookingProvider 新事件 → 回填 'booked'
  - 短链点击回调 → 回填 'opened'
  - 7 天超时 → 回填 'no_response'
  ↓
回填后写入更新事件到 events.jsonl
  ↓
§3.11 反馈分析器读取已回填的事件，计算 touchpoint_performance
```

**V1 实现**：CRM 手动标记 + BookingProvider 自动监听 + 7 天超时自动标记。
**V2 增强**：短链点击追踪 + 微信已读回执 + WebHook 实时回调。

---

### 3.11 模块 11：**反馈分析器（Feedback Analyzer）** —— 核心！

> **让探星从「固定剧本」变成「自适应系统」**。

**目的**：从真实结果中学习，自动调优 4 件事：
1. **关键词权重** —— 哪个关键词 → 转化最高？
2. **钩子风格追踪** —— 哪种话术 → 回复率/成交率最高？
3. **Persona 价值排序** —— 哪类客户最值得追？
4. **互动时段** —— 什么时间发私信效果最好？

**子功能**：

| 子功能 | 频率 | 输出 |
|---|---|---|
| **关键词效果归因** | 每周 | `channels.yaml` 关键词权重自动调整 |
| **钩子风格追踪** | 持续 | 每次生成钩子时记录使用的风格（§3.4 lead.hook_style），按风格统计回复率/成交率，自动选最优风格；非经典 A/B（无随机对照），而是「历史最优 + 持续追踪」|
| **Persona 价值排序** | 每周 | `profile.yaml` 的 personas 加 `value_score` 字段 |
| **互动时段分析** | 每周 | 推荐每个 persona 的最佳互动时段 |
| **自动调优建议** | 每周一 09:00 | 微信推送「本周探星优化建议」 |

**核心数据流**（含 4 条闭环回路）：
```
┌─────────────────────────────────────────────────────────────┐
│  事件采集层（贯穿所有模块）                                    │
│                                                               │
│  ① lead 状态变化 → 写入 events.jsonl                         │
│  ② 转化触达（§3.10 recordTouchpoint）→ 写入 events.jsonl    │
│  ③ 钩子生成时记录使用的风格（§3.4 lead.hook_style）            │
│  ④ 任务执行时记录互动时间（§3.6 scheduled_at）                │
└───────────────────────┬─────────────────────────────────────┘
                        ↓
事件结构（扩展版，支持全链路归因）：
{
  // --- 基础事件 ---
  "event": "lead_status_changed" | "touchpoint_sent" | "touchpoint_result",
  "cid": "comment_xxx",
  "from_status": "<lifecycle_states>",
  "to_status": "<lifecycle_states>",
  "interaction_time": "ISO 8601",

  // --- 来源归因（闭环关键：从 lead 记录中携带） ---
  "source_keyword": "<触发该 lead 的关键词>",
  "source_video_id": "<来源视频 ID>",
  "persona": "<目标人设>",

  // --- 钩子归因（闭环关键：从 lead.hook_style 携带，CRM 持久化） ---
  "hook_style": "<实际使用的钩子风格>",
  "hook_text": "<实际生成的话术>",

  // --- 转化路径归因（闭环关键：从 §3.10 TouchpointEvent 携带） ---
  "touchpoint_action_id": "<关联的触达 action_id>",
  "touchpoint_type": "send_pdf | send_booking_link | send_followup | reactivate",
  "touchpoint_content": "<推送内容摘要>",
  "touchpoint_result": "opened | replied | booked | no_response",

  "days_to_convert": <整数>
}
                        ↓
每周日凌晨跑分析
                        ↓
输出 data/feedback/weekly-insights.json
                        ↓
{
  // 回路 1：关键词 → 侦察（已闭合）
  "keyword_performance": [
    { "keyword": "<关键词 A>", "leads": 50, "conversions": 5, "full_funnel_rate": 0.08, "weight": 1.2 },
    { "keyword": "<关键词 B>", "leads": 30, "conversions": 1, "full_funnel_rate": 0.02, "weight": 0.3 }
  ],

  // 回路 2：钩子风格 → 话术生成器（🆕 闭合）
  "hook_style_performance": [
    { "style": "<style A>", "tested": 100, "replied": 25, "replied_rate": 0.25, "converted": 8, "converted_rate": 0.08 },
    { "style": "<style B>", "tested": 100, "replied": 18, "replied_rate": 0.18, "converted": 3, "converted_rate": 0.03 }
  ],

  // 回路 3：persona 价值 → 任务调度优先级（🆕 闭合）
  "persona_value": [
    { "persona": "<persona A>", "leads": 40, "conversions": 6, "revenue": 300000, "value_score": 9.5, "avg_days_to_convert": 12 },
    { "persona": "<persona B>", "leads": 30, "conversions": 1, "revenue": 50000, "value_score": 4.0, "avg_days_to_convert": 25 }
  ],

  // 回路 4：互动时段 → 任务推送时间（🆕 闭合）
  "best_interaction_times": {
    "self_media": ["周二 14:00-16:00", "周五 20:00-22:00"],
    "ecommerce": ["工作日 09:00-11:00"]
  },

  // 🆕 回路 5：转化路径触达效果 → 物料/触达策略优化
  "touchpoint_performance": [
    { "type": "send_pdf", "content": "<PDF 名>", "sent": 50, "opened": 30, "booked": 8, "open_rate": 0.60, "book_rate": 0.16 },
    { "type": "send_booking_link", "content": "<链接>", "sent": 50, "opened": 20, "booked": 12, "open_rate": 0.40, "book_rate": 0.24 }
  ],

  // 🆕 全链路漏斗（不再只有"加微率"，而是 keyword → 加微 → 触达 → 预约 → 成交）
  "full_funnel": {
    "total_leads": 200,
    "wechat_added": 30,
    "touchpoint_sent": 28,
    "booked": 10,
    "converted": 4,
    "top_converting_keyword": "<关键词 A>",
    "top_converting_hook_style": "<style A>",
    "top_converting_persona": "<persona A>",
    "top_converting_touchpoint": "send_booking_link"
  }
}
                        ↓
自动应用（4 条回路同时生效）：
  ↓ 回路 1：调整 business/channels.yaml 关键词权重
  ↓ 回路 2：更新 data/feedback/weekly-insights.json → §3.4 generateHook() 读取最优风格
  ↓ 回路 3：更新 data/feedback/weekly-insights.json → §3.6 generateDailyTasks() 按 persona 价值排序
  ↓ 回路 4：更新 data/feedback/weekly-insights.json → §3.6 generateDailyTasks() 按最佳时段推送
  ↓ 回路 5：更新 data/feedback/weekly-insights.json → 转化日报展示最优触达方式
   ↓
下一轮侦察 + 引导 + 转化按新参数执行 = 真正闭环
```

**每周一 09:00 推送**「探星优化建议」（示例数据，关键词 / 风格 / persona 名称均来自 `business.example/燃点-FDE/channels.yaml` + `profile.yaml`）：
```
📊 探星优化建议（基于上周数据）

[全链路漏斗]
新发现 200 → 加微 30 → 触达 28 → 预约 10 → 成交 4（总转化率 2.0%）

[关键词调整]（回路 1：→ 侦察）
✅ 提升 "<关键词 A>" 权重至 1.2x（全链路转化率 8%）
⬇️ 降低 "<关键词 B>" 权重至 0.3x（全链路转化率 2%）

[钩子风格]（回路 2：→ 话术生成器）
📈 "<style A>" 回复率 25% / 成交率 8%，明显优于"<style B>"（18% / 3%）
✅ 已自动应用：钩子生成器默认使用 "<style A>"

[Persona 价值]（回路 3：→ 任务调度优先级）
💎 "<persona A>" 价值分 9.5，平均 12 天成交，本月带来 30 万营收
💤 "<persona B>" 价值分 4.0，平均 25 天成交，本月仅 5 万
✅ 已自动应用：高价值 persona 的 lead 优先出任务

[时段]（回路 4：→ 任务推送时间）
"<persona A>" 最佳互动时段：周二 14:00-16:00 / 周五 20:00-22:00
"<persona B>" 最佳互动时段：工作日 09:00-11:00
✅ 已自动应用：任务按 persona 最佳时段分批推送

[触达方式]（回路 5：→ 转化策略）
📈 发预约链接：book_rate 24%，优于发 PDF（16%）
建议：加微后优先发预约链接，PDF 作为补充资料
[需手动确认] 是否调整转化路径顺序？

[已自动应用] 关键词权重 / 钩子风格 / persona 排序 / 推送时段 已更新
```

**CLI**：
```bash
# 手动跑分析
npx explore-star analyze-feedback --business=./my-business

# 查历史 insights
npx explore-star insights --business=./my-business --last=4weeks

# 关闭某个建议的自动应用
npx explore-star configure --business=./my-business --disable=auto_keyword_weight
```

**关键设计**：
- 反馈分析产出**两类结果**：
  - **自动应用**（回路 1-4）：关键词权重、钩子风格、persona 排序、推送时段——直接写入 `weekly-insights.json`，下游模块每次运行时读取最新版本，**无需重启即生效**
  - **需确认**（回路 5）：转化路径顺序调整（如"先发预约链接再发 PDF"）——推送给用户确认后手动调整 `conversion.yaml`
- 所有自动调整都有「开关」，用户可关掉某个维度的自动应用
- 至少积累 **2 周数据** 后才出建议（前 2 周是「学习期」）
- **全链路归因**：事件结构支持从「关键词 → 加微 → 触达 → 预约 → 成交」的完整追踪，不再只有「关键词 → 加微率」的局部归因

#### 冷启动行为（前 2 周 learning period）

`weekly-insights.json` 在前 2 周不存在时，各下游模块的 fallback 行为：

```typescript
// §3.4 generateHook() 冷启动 fallback
const insights = await loadLatestInsights(profile.business.name);
// insights 为 null → 以下全部走默认值
const hookStyle = insights?.hook_style_performance  // null
  ?.sort((a, b) => b.rate - a.rate)[0]?.style       // undefined
  ?? profile.hook_config.style                       // 使用 profile.yaml 配置的默认风格
  ?? '像朋友推荐，不像销售';                           // 兜底默认值

// §3.6 generateDailyTasks() 冷启动 fallback
const personaScores = new Map(
  (insights?.persona_value ?? [])                    // 空数组
    .map(p => [p.persona, p.value_score])
);
// personaScores 为空 → 所有 persona 得分 fallback 到 5.0 → 按原始顺序排列
leads.sort((a, b) => {
  const scoreA = personaScores.get(a.persona) ?? 5.0;  // 全部 5.0
  const scoreB = personaScores.get(b.persona) ?? 5.0;
  return scoreB - scoreA;  // 无实际排序效果
});

// §3.6 generateDailyTasks() 时段 fallback
const bestTimes = insights?.best_interaction_times ?? {};  // 空对象
pickBestTime(bestTimes[lead.persona]);  // bestTimes[persona] 为 undefined → 返回默认时段 09:30
```

**冷启动期间各回路行为**：

| 回路 | 冷启动行为 | 说明 |
|---|---|---|
| 回路 1：关键词权重 | `channels.yaml` 中权重全部为初始值（1.0）→ 等权搜索 | 2 周后按数据调整 |
| 回路 2：钩子风格 | 使用 `profile.yaml → hook_config.style` 默认值 | 2 周后按回复率选最优 |
| 回路 3：persona 排序 | 所有 persona 得分 5.0 → 无优先级 | 2 周后按转化率排序 |
| 回路 4：互动时段 | 统一 09:30 推送 | 2 周后按效果数据分批 |
| 回路 5：触达方式 | 使用 `conversion.yaml` 中的默认顺序 | 2 周后按效果推荐 |

**`loadLatestInsights()` 函数定义**：
```typescript
/**
 * 加载最新的 weekly-insights.json
 * @returns insights 对象，冷启动期间返回 null
 */
async function loadLatestInsights(businessName: string): Promise<WeeklyInsights | null> {
  const path = `data/feedback/weekly-insights.json`;
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;  // 文件不存在 → 冷启动，返回 null
  }
}
```

---

---

## 4. 模块依赖关系图（含 5 条反馈回路）

```
                          BusinessProfile (profile.yaml)
                                     ↓
        ┌────────────────┬──────────┴───────────┬─────────────────┐
        ↓                ↓                      ↓                 ↓
   LLMProvider     ChannelAdapter          CRMAdapter         Notifier
   (M8, §13.4.2)   (DouyinChannel,         (FeishuAdapter,   (Wechat,
   OpenAI/         M9, §13.4.3)            NotionAdapter,    Feishu,
   DeepSeek/       ↓                        CsvAdapter)       Email)
   Anthropic/  opencli douyin search (M1)   ↑
   Ollama)         ↓
              opencli douyin comment (M2)
                     ↓
         ┌─ 阶段 1: 侦察 ────────────────┐
         ↓                                │
   LLM intent analyzer (M3) ────→ LLM Provider
         │  写入 source_keyword / source_video_id（供 §3.11 归因）
         ↓
   RAG hook generator (M4) ──────→ LLM Provider + Embeddings
         │  读取 weekly-insights.json 最优钩子风格（回路 2）
         │  写入 lead.hook_style（供 §3.11 归因）
         ↓
   CRM sync (M5) ───────────────→ CRM Adapter
         ↓
         └────────────────────────────────┘
                     ↓
         ┌─ 阶段 2: 引导 ────────────────┐
         ↓                                │
   Nurturing engine (M6) ─────────→ CRM Adapter (读 + 写状态)
         │  读取 weekly-insights.json persona 价值排序（回路 3）
         │  读取 weekly-insights.json 最佳互动时段（回路 4）
         ├─ 互动效果感知 (§3.6.2)          │
         ├─ 智能放弃判定 (§3.6.3)          │
         └─ 再激活队列 (§3.6.4)            │
         ↓
   Orchestrator + Notify (M7) ───→ Notifier (早报/晚报/任务)
         ↓
         └────────────────────────────────┘
                     ↓
         ┌─ 阶段 3: 转化 ────────────────┐
         ↓                                │
   Conversion Engine (M10) ────────→ CRM Adapter (写状态)
         │  recordTouchpoint() 写入触达事件（供 §3.11 归因）
         ├─ 加微后自动推送 PDF + 预约链接   │
         ├─ 飞书日历 WebHook 监听预约      │
         ├─ 22:00 推送转化日报（含全链路漏斗）│
         ├─ ROI 计算                       │
         └─ 沉默客户再激活                 │
         ↓
   Notifier (转化日报/Hot Leads 提醒)
         ↓
         └────────────────────────────────┘
                     ↓
         ┌─ 阶段 4: 反馈 ────────────────┐
         ↓                                │
   Feedback Analyzer (M11) ────────→ CRM Adapter (读事件)
         │  读取全链路事件（状态变化 + 触达 + 钩子风格 + 互动时间）
         ├─ 周日凌晨 03:00 跑分析          │
         ├─ 输出 weekly-insights.json      │
         ↓                                │
   ┌─ 5 条反馈回路同时生效 ──────────────┐│
   │                                      ││
   │  回路 1: 关键词权重 → channels.yaml  ││
   │          → 下一轮侦察按新权重执行     ││
   │                                      ││
   │  回路 2: 最优钩子风格 → M4 读取      ││
   │          → 下一次生成话术用最优风格   ││
   │                                      ││
   │  回路 3: persona 价值排序 → M6 读取  ││
   │          → 高价值 lead 优先出任务     ││
   │                                      ││
   │  回路 4: 最佳互动时段 → M6 读取      ││
   │          → 任务按最佳时段分批推送     ││
   │                                      ││
   │  回路 5: 触达方式效果 → 转化日报     ││
   │          → 推荐最优触达策略（需确认） ││
   └──────────────────────────────────────┘│
         └────────────────────────────────┘
              ↻ 5 条回路 = 真正闭环
```

**关键依赖反转**：所有模块只依赖**接口**（`LLMProvider` / `CRMAdapter` / `ChannelAdapter` / `Notifier`），不依赖具体实现。

**5 条闭环回路关键点**：
- 回路 1-4 是**自动应用**：下游模块每次运行时读取最新 `weekly-insights.json`，无需重启
- 回路 5 是**需确认**：触达策略调整推送给用户确认后手动调整
- 没有反馈回路 = 固定剧本 = 永远不能进化
- 5 条回路 = 全链路自适应 = 侦察/引导/转化三个阶段都在进化

---

---

---

## 5. 错误处理、账号安全与性能

### 5.1 错误处理（3 层防御）

**第 1 层：模块内自愈** —— 每个模块自带 3 次重试（指数退避 1s, 3s, 9s），失败后写 `data/failed/<module>-<date>.json` 跳过。

**第 2 层：编排器级别** —— `run-daily.sh` 维护 `data/state.json`，每步完成后写入状态；下次启动跳过已完成步骤（断点续传）。脚本末尾根据 EXIT_CODE 推送告警。

**第 3 层：系统级监控** —— `health-check.sh`（独立 cron，每 6h 跑）：检查今日是否成功、磁盘是否充足、cron 是否还在跑。

### 5.2 账号安全 5 铁律（自动执行的安全边界）

> 以下铁律由 `task-executor` 模块**自动执行**——不是给人看的规则，是给代码的硬约束。任何一条被触发，自动停止当天任务。

| 铁律 | 实现 | 风险值 |
|---|---|---|
| **1. 专用 Chrome Profile** | 给探星建独立的 Chrome 用户配置 | 必做 |
| **2. 真人节律** | 每调用间隔 3-8 秒随机；每轮任务 ≤ 30 分钟 | 必做 |
| **3. 当日限额** | 每天 ≤ 50 视频 / 5000 评论 / 5 好友 / 10 私信 | 必做 |
| **4. 错峰运行** | 早 9 / 下午 2 / 晚 8 点（避免连续猛跑）| 推荐 |
| **5. 养号优先** | 用注册 > 6 个月、有内容的**老号**跑探星 | 必做 |

**限速配置**（`config/safety.json`）：
```json
{
  "rate_limits": {
    "douyin.search.calls_per_hour": 10,
    "douyin.comment.calls_per_hour": 30,
    "douyin.friend_request.per_day": 5,
    "douyin.dm.per_day": 10,
    "opencli.min_interval_seconds": 3,
    "opencli.max_interval_seconds": 8
  },
  "daily_budget": {
    "videos": 50,
    "comments_scanned": 5000,
    "leads_created": 200,
    "engagement_actions": 20
  }
}
```

**风控信号监测**（`scripts/safety-monitor.js`）每次 run 后跑：
- 滑块验证 > 3 次 → 告警
- 搜索空结果率 > 50% → 告警（疑似限流）
- IP 切换 > 5 次 → 告警
- 私信被退 > 0 → 🚨 立即停止私信任务

**紧急停止开关**：`touch config/EMERGENCY_STOP` 文件存在即停。

**风控恢复流程**：收到告警 → 立即 `touch EMERGENCY_STOP` → 7 天养号（仅刷视频、点赞、关注）→ 第 8 天手动验证 → 降低 50% 限额重启。

### 5.3 性能与成本

**每日数据量与耗时**：

| 环节 | 数据量 | 耗时 |
|---|---|---|
| 视频搜索 | 50 | ~5 分钟 |
| 评论抓取 | 10000 条 | ~30 分钟 |
| 预处理 | 6000 有效 | < 1 分钟 |
| LLM 意图分析 | 6000 条 | ~20 分钟 |
| 钩子生成 | 200 高意向 | ~5 分钟 |
| 飞书同步 | 200 条 | < 1 分钟 |
| 引导任务生成 | 8-20 任务 | < 1 分钟 |
| 🆕 自动执行 | 8-20 任务 | ~15-30 分钟（含 3-8 秒间隔）|
| 通知 | 3 次推送 | < 1 分钟 |
| **总计** | | **~1.5 小时**（全自动，无需人工）|

**LLM 月成本**（每月 ~300 万 tokens 总量）：

| 模型 | 月成本 |
|---|---|
| gpt-4o-mini（默认）| ~120 元 |
| deepseek-v3（降本）| ~15 元 |

**资源占用**：磁盘 ~1.5GB/月；内存峰值 < 1GB；CPU 不密集。Mac mini / M1 都跑得动。

### 5.4 可观测性

**日志体系**：
```
logs/
├── 2026-06-01.log           # 每日主日志
├── 2026-06-01.md            # 每日探星日报
├── error-2026-06-01.log     # ERROR 级别
└── failed/                  # 失败任务归档
```

**探星日报**（自动生成）包含：当日数据 / Top 3 客户 / 风控信号 / 成本。

**告警规则**：

| 触发条件 | 级别 | 通知 |
|---|---|---|
| 单日滑块验证 > 3 | 🚨 critical | 微信 + 飞书 |
| 连续 2 天 0 高意向 | ⚠️ warning | 微信 |
| LLM 失败率 > 10% | ⚠️ warning | 微信 |
| 磁盘 > 80% | ⚠️ warning | 微信 |
| 24h 未成功 run | 🚨 critical | 微信 + 飞书 |
| 探星日报未生成 | ⚠️ warning | 微信 |

### 5.5 灾备

**数据备份**：每天 23:00 自动 `tar -czf backups/${DATE}.tar.gz data/ knowledge/ config/`，保留最近 30 天。

**配置版本化**：`config/` 单独 git 仓库。

**Chrome Profile 备份**：每周日备份 `~/Library/Application Support/Google/Chrome/探星Profile/`。

**断点续传**：通过 `data/state.json` 实现；提供 `scripts/test-resume.sh` 验证。

### 5.6 合规边界

| 行为 | 风险 |
|---|---|
| 抓公开视频元数据 | 🟢 低 |
| 抓公开评论 | 🟡 中（禁止用于商业营销）|
| 抓用户昵称/签名 | 🟡 中（个人信息，不公开）|
| 批量私信 | 🔴 高（违反抖音协议）|
| 伪装身份/案例宣传 | 🔴 极高（违反广告法）|
| 用抓的数据训练 AI | 🔴 极高（违反数据安全法）|

**本系统的合规承诺**：
- ✅ 只抓公开视频元数据
- ✅ 评论分析**不上传**给 LLM 训练（API 禁用训练）
- ✅ 私信内容由 LLM 生成 + **业务方可选审核**（`hook_review: true`），程序按限速自动发送
- ✅ 客户数据**只存本地 + 用户自选 CRM**，不对外
- ✅ 任何**案例宣传**必须是真实的、已签约的项目
- ✅ **用户责任**：使用本工具须遵守当地法律法规；本项目作者不为用户的滥用行为负责（详见 LICENSE）

### 5.7 Business Profile 加载与热替换

**冷启动加载**：
```typescript
// src/core/business-profile.ts
export async function loadBusinessProfile(businessPath: string): Promise<BusinessProfile> {
  const profilePath = join(businessPath, 'profile.yaml');
  const raw = await readFile(profilePath, 'utf-8');
  const profile = yaml.parse(raw);

  // 校验必填字段
  validateProfile(profile);

  // 加载 prompts 模板
  profile.prompts = await loadPrompts(join(businessPath, 'prompts'));

  // 加载 knowledge 索引
  profile.knowledge = await loadKnowledgeIndex(join(businessPath, 'knowledge'));

  return profile;
}

function validateProfile(p: any) {
  const required = ['business.name', 'business.value_prop', 'target_personas', 'llm'];
  for (const field of required) {
    if (!get(p, field)) {
      throw new Error(`Business profile 缺少必填字段: ${field}`);
    }
  }
  if (p.target_personas.length < 1) {
    throw new Error('target_personas 至少要 1 个');
  }
}
```

**热替换**（开发模式）：
```bash
# 修改 profile.yaml 后无需重启，下次 run 自动加载最新配置
npx explore-star run --business=./my-business --watch
# --watch: 检测到 profile.yaml 变化后自动重载
```

**多业务并存**（同一台机器上同时跑多个业务，每个独立 cron 调度 + 独立数据目录）：
```
explore-star/
├── business-example/        # business.example/ 拷贝并改名为业务 A 的实际配置
├── business-meilian/        # 业务方自定义的第二个业务（OPC 第二个赛道 / 朋友 fork 用）
└── business-test/           # 测试业务（开发 / 调试用）
```
各业务独立运行、独立数据。业务方应使用**自己的业务名**作为目录名（如 `business-我的律所/`），**不要**使用原作者业务名以避免混淆。

---

## 6. 测试策略

### 6.1 4 层测试

| 层级 | 工具 | 频率 |
|---|---|---|
| 单元测试 | vitest，覆盖 7 个模块 | 每天写代码时 |
| 集成测试 | `scripts/integration-test.sh`（4 个健康检查） | 每天 run 后 |
| 端到端验收 | `scripts/e2e-test.sh`（迷你流程） | 首跑 + 每周 |
| 人工抽检 | 每天 5 条 lead 评分 | 每天 |

### 6.2 关键样本

手工标注 30 条评论（15 意向 / 15 非意向）作为「金标准」，用于 LLM 准确率测试。

---

## 7. 验收标准

### 7.1 硬指标（必须达到）

| 阶段 | 指标 | 目标值 | 测量方法 |
|---|---|---|---|
| **侦察** | Channel 适配器 | 抖音至少 1 个跑通 | `opencli douyin search` / `comment` |
| **侦察** | 每日自动扫描 | 50 视频 / 5000 评论 | 探星日报 |
| **侦察** | LLM 意图分析准确率 | > 80% | 业务方标注样本 |
| **侦察** | CRM 同步 | 100% 成功 | 探星日报 |
| **引导** | 引导任务生成 | 每天 5-20 条 | 探星日报 |
| **引导** | 互动效果感知 | 在 CRM 标记 → 引擎 24h 内自动决策 | 单元测试 + 人工 |
| **引导** | 智能放弃判定 | 执行 3 次 0 回应 → 标记流失 | 单元测试 |
| **引导** | 再激活队列 | 30 天沉默客户进池 | 探星日报 |
| **转化** | 🆕 转化日报 | 每天 22:00 准时推送 | 手工验证 |
| **转化** | 🆕 加微后自动推物料 | 24h 内 100% 触发 | CRM 时间戳 |
| **转化** | 🆕 预约监听 | BookingProvider 新事件 → CRM 状态自动更新 | 集成测试 |
| **转化** | 🆕 沉默客户再激活 | 每月 1 日自动尝试 | 探星日报 |
| **转化** | 🆕 ROI 计算 | 转化日报含 ROI 字段 | 探星日报 |
| **反馈** | 🆕 事件记录 | 所有 lead 状态变化 + 转化触达入 events.jsonl | 日志 |
| **反馈** | 🆕 全链路归因 | 事件含 source_keyword / hook_style / touchpoint_type | 日志 |
| **反馈** | 🆕 每周分析 | 周一 09:00 推送优化建议（含全链路漏斗） | 手工验证 |
| **反馈** | 🆕 回路 1：关键词权重自动调整 | 每周凌晨 03:00 应用 | channels.yaml diff |
| **反馈** | 🆕 回路 2：钩子风格自动应用 | generateHook() 读取最优风格 | weekly-insights.json → 生成日志 |
| **反馈** | 🆕 回路 3：persona 价值排序生效 | 高价值 lead 优先出任务 | 任务排序日志 |
| **反馈** | 🆕 回路 4：最佳时段推送生效 | 任务按 persona 最佳时段分批推送 | 任务 scheduled_at 日志 |
| **反馈** | 🆕 回路 5：触达方式效果 | 转化日报展示最优触达方式 | 转化日报 |
| **基础** | 通知 | 每天 3 次（早/晚/转化）| 手工验证 |
| **基础** | 0 封号 | 连续 30 天 | 安全监控 |
| **基础** | 月成本 | < 500 元 | 探星日报 |

### 7.2 框架级漏斗指标（业务无关，1 个月后）

> **关于"业务效果"**：本文档是**框架设计文档**，不假设具体业务的经济学。下表只列**框架流程本身的转化漏斗**——不涉及营收 / LTV / ROI 等业务专属指标。
>
> 业务方应在自己业务的 `business.example/燃点-FDE/README.md`（或对应业务目录的 README）里维护**业务专属效果表**。燃点 FDE 示例的占位效果表见 `docs/business-models/燃点-FDE-业务效果.md`（首版实现时同步发布）。

| 阶段 | 指标 | 保守目标 | 乐观目标 | 说明 |
|---|---|---|---|---|
| **侦察** | 月新增意向 lead | 1500-2500 | 3000-5000 | 通过业务画像阈值（`intent_score > 0.7`）的 lead 数 |
| **引导** | 月加好友 | 30-50 | 80-150 | 状态推进到「已加好友」的 lead 数 |
| **转化** | 🆕 月进入业务下一步 | 5-10 | 15-30 | 状态推进到 `lifecycle_states` 中"已预约/已试用/已咨询"等业务自定义状态的 lead 数 |
| **转化** | 🆕 月成交 | 1-3 | 3-8 | 状态推进到「已成交」的 lead 数（具体含义由业务方定义） |
| **反馈** | 🆕 反馈调优后转化率提升 | 20%+ | 50%+ | 反馈分析器启用后，下月 vs 上月的同阶段转化率对比 |
| **反馈** | 🆕 全链路归因覆盖率 | > 90% | 100% | events.jsonl 中含 source_keyword + hook_style + touchpoint_type 的事件占比 |
| **反馈** | 🆕 5 条回路生效数 | 4/5 | 5/5 | 回路 1-4 自动应用 + 回路 5 推荐确认 |
| **基础** | 月 LLM 成本 | < 50 元 | < 15 元 | 通过 DeepSeek 可降至 < 15 元 |
| **基础** | 框架月总成本 | < 100 元 | < 50 元 | 仅含 LLM + 向量库 + 通知 API；**不含**业务方的人力投入 |

### 7.3 失败判定（任一触发即复盘）

- 🚨 连续 7 天 0 高意向 lead
- 🚨 抖音号被封
- 🚨 连续 3 天 run-daily.ts 失败
- 🚨 月成本 > 1000 元
- 🚨 转化日报连续 3 天没推送
- 🚨 反馈分析器连续 2 周不出建议（数据可能有问题）
- 🚨 任何合规风险出现

---

## 8. 实施路线图

> 实施顺序：先做**核心 4 阶段**（侦察 → 引导 → 转化 → 反馈），再做**开源化**（adapter / example / 文档）。

### Day 0：准备（半天）

| 任务 | 产出 |
|---|---|
| 创建 Chrome 专用 Profile（"探星Profile"） | Chrome 桌面端配置 |
| 用这个 Profile 登录抖音 + 关注 10 个目标行业账号养号 | 养号开始 |
| 申请飞书开放平台应用 + 创建多维表 + 拿到 app_id/secret | 飞书就绪 |
| 准备 OpenAI/DeepSeek API Key | LLM 就绪 |
| 初始化 npm 项目 + TypeScript 配置 | 项目骨架 |
| `git init` + 添加 LICENSE (MIT) + 第一次 commit | 开源就绪 |

**Day 0 验收**：所有前置条件满足，能用 Chrome 登录态打开抖音；项目 `npm install` 成功。

### Day 1：OpenCLI 适配器（核心难点，1 天）

| 任务 | 工时 |
|---|---|
| 复制 tiktok/search.js → 改 douyin/search.js | 3h |
| 复制 tiktok/comment.js → 改 douyin/comment.js | 3h |
| 跑通 + 手工验证 5 个视频 + 50 条评论 | 1h |
| 写单元测试 | 1h |

**🛑 风险点**：抖音搜索接口路径可能与 TikTok 不一样。如失败，回退到 `opencli browser` 手动导航方案。

### Day 2：Adapter 抽象 + LLM 意图分析（架构奠基）

| 任务 | 工时 |
|---|---|
| 写 `src/adapters/types.ts`（LLMProvider / CRMAdapter / ChannelAdapter / Notifier 接口）| 2h |
| 写 `src/adapters/llm/openai.ts` + `deepseek.ts` | 2h |
| 写 `src/core/business-profile.ts`（profile.yaml 加载）| 1h |
| 写 `src/modules/intent-analyzer/index.ts` + 用模板变量替换硬编码 prompt | 2h |
| 准备 30 条标注样本 + 跑准确率测试 | 1h |

### Day 3：RAG + CRM Adapter

| 任务 | 工时 |
|---|---|
| 写 `rag/build-index.ts` + `retrieve.ts` + `generate-hook.ts`（带模板）| 3h |
| 写 `src/adapters/crm/feishu.ts` | 2h |
| 写 `src/adapters/crm/csv.ts`（开发用） | 0.5h |
| 手工评估 5 个钩子质量 + 飞书同步测试 | 0.5h |

### Day 4：引导引擎（含互动感知 + 放弃判定 + 再激活）

| 任务 | 工时 |
|---|---|
| 写 `src/modules/nurture-engine/index.ts` + 状态机 | 2h |
| 加 **互动效果感知**（§3.6.2）—— CRM 标记 → 引擎自动决策 | 1h |
| 加 **智能放弃判定**（§3.6.3）—— 3 次 0 回应 → 流失 | 0.5h |
| 加 **再激活队列**（§3.6.4）—— 30 天沉默进池 | 0.5h |
| 写 `src/adapters/notifier/wechat.ts` + `feishu.ts` | 2h |
| 跑 50 个 mock lead 验证 30 天模拟 | 1h |

### Day 5：编排 + 监控 + 安全

| 任务 | 工时 |
|---|---|
| 写 `src/orchestration/run-daily.ts` | 2h |
| 写 `config/safety.json` + 限速逻辑 | 1h |
| 写 `health-check.ts` + 紧急停止开关 | 1h |
| 写探星日报生成逻辑（侦察日报） | 1h |
| 配 cron | 1h |

### Day 6：**转化引擎**（核心！）

| 任务 | 工时 |
|---|---|
| 写 `src/modules/conversion-engine/index.ts` + 加微后自动推物料逻辑（物料来自 `business/conversion.yaml`）| 2h |
| 写 `BookingProvider` adapter 抽象 + 飞书日历实现 + 通用 WebHook 适配 | 2h |
| 写 **转化日报**生成 + 微信推送（22:00）| 1h |
| 写 ROI 计算逻辑 | 0.5h |
| 写 沉默客户再激活（月度） | 0.5h |
| 准备 1 套示例转化物料 + 配置 `business.example/燃点-FDE/conversion.yaml`（仅作示例参考）| 1h |

**🛑 关键依赖**：Day 6 需要飞书日历 API 配置（V1.0 已配好的多维表是日历的姊妹能力）。

### Day 7：**反馈分析器**（核心！）

| 任务 | 工时 |
|---|---|
| 写 `data/feedback/events.jsonl` 事件记录机制（贯穿所有模块）| 1h |
| 写 `src/modules/feedback-analyzer/index.ts` 主体 | 1h |
| 写 关键词效果归因 + 钩子风格 A/B + Persona 价值排序 | 2h |
| 写 周一 09:00「探星优化建议」推送 | 1h |
| 写 channels.yaml 关键词权重自动应用 | 0.5h |
| 跑 2 周模拟数据，验证反馈引擎能产出合理建议 | 0.5h |

### Day 8-9：业务配置 + 默认示例业务 + CLI 完善

| 任务 | 工时 |
|---|---|
| 创建 `business.example/燃点-FDE/`（**作者业务的脱敏示例**，含 §2.3 MVP 配置；业务方不需要改这里——`init` 会复制一份到自己业务目录）| 3h |
| 写 `business.example/燃点-FDE/knowledge/`（6-8 个 markdown） | 2h |
| 写 `init` / `doctor` 命令 | 2h |
| 写 `run` / `nurture` / `convert` / `analyze-feedback` 命令 | 3h |
| 用作者业务的真实抖音数据跑 3 轮 + 调优 prompt + 调整关键词（用于验证框架 + 沉淀示例配置）| 2h |

### Day 10-11：开源化发布

| 任务 | 工时 |
|---|---|
| 写 README 中英文版 | 2h |
| 写 `docs/quickstart.md` + `docs/configuration.md` + `docs/compliance.md` | 3h |
| 写 `CONTRIBUTING.md`（欢迎贡献新 adapter / 新业务示例）| 1h |
| 写 §13.4 附录（Adapter 接口规范完整版）| 1h |
| 第一个 GitHub Release + npm publish | 1h |

**总计：~75 小时 / 1.5 周（高强度）/ 2 周（舒适节奏）**

> **路线图扩展说明**：v1.2 新增了 §3.6.2-3.6.4 互动感知 / §3.10 转化引擎 / §3.11 反馈分析器，相比 v1.1 多 25 小时。这是为了让探星**真正实现"全流程自动化"**——侦察 → 引导 → 转化 → 反馈 4 阶段闭环。

---

## 9. 里程碑检查点

```
[Day 0]  ✅ 前置就绪
   ↓
[Day 1]  ✅ OpenCLI 适配器跑通（最关键的里程碑）
   ↓       ↓ 如果失败：评估是否回退到方案 B（飞瓜数据）
[Day 5]  ✅ 端到端 MVP 上线
   ↓
[Day 7]  ✅ 连续 3 天稳定运行
   ↓
[Day 30] 📊 看 ROI，决定是否加大投入
   ↓
[Day 60] 🚀 决定是否扩到小红书 / B站
```

---

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 抖音搜索接口变更 | 中 | 高 | 用 `opencli browser` 兜底；准备飞瓜备选 |
| 抖音号被封 | 低-中 | 极高 | 严格遵守 5 铁律；养号；多号备选 |
| LLM 成本失控 | 低 | 中 | 月预算 500 元告警；用 DeepSeek 降本 |
| 飞书 API 限流 | 低 | 中 | 缓存 + 批量 |
| 钩子话术质量差 | 中 | 中 | 持续 A/B；人工抽检 |
| 客户对私信反感 | 中 | 中 | 7 天渐进；提供退订 |
| 真实合规风险 | 低 | 极高 | 严守 §5.6 合规承诺 |

---

## 11. 未来扩展（V2 路线）

> v1.2 已把 v1.0 路线图中的"客户全生命周期追踪"和"AI 自动私信（带 A/B）"分别纳入 §3.10 转化引擎、§3.11 反馈分析器。V2 路线**只列剩下的**：

- [ ] 实现更多 **Channel Adapter**：小红书 / B站 / 视频号 / 快手（详见 §3.9 接口 + §13.4.3）
- [ ] 多抖音号**轮转**（提升单日抓取量；用独立 Chrome Profile 隔离）
- [ ] **Web Dashboard**（可视化探星日报、多业务切换；脱离 CLI）
- [ ] **多业务调度**（一个进程跑多个 business，cron 切分）
- [ ] **落地页双向打通**（CRM lead → 落地页预约；案例库 → RAG 知识库自动同步）
- [ ] **国际化**：英文 README、英文业务示例、英文适配器
- [ ] **客户复购/续约/续费提醒**（已成交客户到期前的智能提醒 + AI 生成话术；具体规则由 `business/conversion.yaml` 的 `post_sale.lifecycle_days` 字段定义）
- [ ] **团队协作**（多用户 / 角色权限 / 操作审计）

---

## 12. 开放问题

| 问题 | 状态 | 决定 |
|---|---|---|
| LLM 模型选择 | ✅ 已决 | 默认 DeepSeek-V3（成本最低），用户可改 OpenAI/Anthropic |
| CRM 默认实现 | ✅ 已决 | 内置 飞书 / Notion / Airtable / 本地 CSV；字段映射见 §3.5 |
| 关键词清单初稿 | 🟡 部分 | 业务方在 `business/channels.yaml` 自行配置；`business.example/燃点-FDE/channels.yaml` 提供 10-15 个示例关键词（仅供该业务参考）|
| 钩子话术风格 | 🟡 部分 | 由 `business/profile.yaml → hook_config.style` 字段定义；默认风格为「朋友推荐」|
| Chrome Profile 名称 | ✅ 已决 | "探星Profile"（中文），用户可改 |
| 开源许可证 | ✅ 已决 | MIT |
| 业务配置架构 | ✅ 已决 | 分层配置（业务/prompts/CRM/渠道/转化各自独立配置）|
| 默认示例 | ✅ 已决 | 脱敏的「燃点 FDE」放在 `business.example/燃点-FDE/`，仅作配置参考 |
| Channel Adapter 抽象 | ✅ 已决 | V1 只实现抖音，V2 扩小红书/B站 |

---

## 13. 附录

### 13.1 目录结构（最终）

```
explore-star/                          # 项目根
├── README.md                          # 中英双语
├── README.zh-CN.md
├── LICENSE                            # MIT
├── CONTRIBUTING.md                    # 欢迎贡献新 adapter
├── CHANGELOG.md
├── package.json                       # npm 包配置
├── tsconfig.json
├── .gitignore
│
├── src/                               # 核心代码（不含任何业务）
│   ├── core/
│   │   ├── business-profile.ts        # profile.yaml 加载
│   │   ├── config.ts                  # 全局配置
│   │   └── types.ts
│   ├── adapters/
│   │   ├── types.ts                   # 接口定义
│   │   ├── registry.ts                # adapter 注册
│   │   ├── llm/
│   │   │   ├── base.ts
│   │   │   ├── openai.ts
│   │   │   ├── deepseek.ts
│   │   │   ├── anthropic.ts
│   │   │   └── ollama.ts
│   │   ├── crm/
│   │   │   ├── base.ts
│   │   │   ├── feishu.ts
│   │   │   ├── notion.ts
│   │   │   ├── airtable.ts
│   │   │   └── csv.ts
│   │   ├── channel/
│   │   │   ├── base.ts
│   │   │   └── douyin.ts
│   │   └── notifier/
│   │       ├── base.ts
│   │       ├── wechat.ts
│   │       ├── feishu.ts
│   │       └── email.ts
│   ├── modules/
│   │   ├── search/
│   │   ├── comment-fetch/
│   │   ├── intent-analyzer/
│   │   ├── hook-generator/            # 含 RAG
│   │   ├── crm-sync/
│   │   ├── nurture-engine/
│   │   ├── task-executor/             # 🆕 自动执行引导任务（登录态浏览器）
│   │   ├── conversion-engine/         # 🆕 转化引擎
│   │   └── feedback-analyzer/         # 🆕 反馈分析器
│   ├── orchestration/
│   │   ├── run-daily.ts
│   │   ├── state.ts                   # 断点续传
│   │   └── health-check.ts
│   ├── cli/
│   │   ├── index.ts                   # CLI 入口
│   │   ├── init.ts
│   │   ├── doctor.ts
│   │   ├── run.ts
│   │   ├── search.ts
│   │   ├── analyze.ts
│   │   ├── generate-hook.ts
│   │   └── nurture.ts
│   └── notify/
│       └── ...
│
├── business.example/                  # 🆕 作者业务的脱敏示例（业务方 init 时复制并改名）
│   └── 燃点-FDE/                       # 默认示例（作者的真实业务脱敏版）
│       ├── README.md
│       ├── profile.yaml
│       ├── prompts/
│       │   ├── intent-system.md
│       │   ├── intent-user.md
│       │   ├── hook-reply.md
│       │   └── hook-dm.md
│       ├── knowledge/
│       │   ├── 01-cases/
│       │   ├── 02-methodology/
│       │   ├── 03-hooks/
│       │   └── 04-faq/
│       ├── crm.yaml
│       ├── channels.yaml
│       └── conversion.yaml
│
├── docs/
│   ├── superpowers/specs/
│   │   └── 2026-06-01-explore-star-design.md   ← 本文档
│   ├── quickstart.md                  # 🆕 5 分钟上手
│   ├── configuration.md               # 🆕 详细配置
│   ├── adapters.md                    # 🆕 写自定义 adapter
│   ├── faq.md
│   └── compliance.md                  # 合规使用指南
│
├── scripts/
│   ├── filter-videos.js
│   ├── integration-test.sh
│   ├── e2e-test.sh
│   ├── safety-monitor.ts
│   ├── test-resume.sh
│   └── publish.sh                     # 发布到 npm
│
├── data/                              # 运行时数据（gitignore）
│   ├── state.json
│   ├── vectors.db
│   ├── tmp/
│   └── failed/
├── logs/                              # 日志（gitignore）
└── backups/                           # 备份（gitignore）
```

### 13.2 关联项目

> **说明**：本节列出的"关联项目"是**原作者使用的具体技术资产**，仅供了解作者技术栈参考。**框架本身不依赖这些项目**——业务方使用任何替代方案（如自建落地页 / 不同的浏览器自动化方案）都可正常运行。

- **OpenCLI**：https://github.com/jackwener/opencli —— 提供 `clis/douyin/` 适配器位 + 浏览器自动化（V1 依赖）
- **作者业务落地页**（仅作示例参考）：`/Users/lylyyds/Desktop/fde-landing/` —— 原作者 燃点 FDE 业务的落地页，业务方可使用任意替代方案
- **本项目位置**：`/Users/lylyyds/Desktop/explore-star/`（框架代码）

### 13.3 变更日志

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-06-01 | 初始设计 |
| v1.1 | 2026-06-01 | 新增开源定位（MIT + 分层配置 + business.example）|
| v1.2 | 2026-06-01 | **新增 §3.10 转化引擎 + §3.11 反馈分析器；增强 §3.6 引导引擎（互动感知 / 智能放弃 / 再激活）；§3.0/3.8/3.9 简化为指向附录的指针；§2.3 简化为 MVP；§8 路线图扩展到 10-11 天** |
| v1.3 | 2026-06-01 | **业务解耦**：移除所有硬编码的「燃点 FDE」业务细节；§1.1 重写为通用框架背景；§3.4 RAG 钩子生成器模板化；§3.7/§3.10/§7/§8/§11/§12/§14.5 中的业务专属内容剥离到 `business.example/燃点-FDE/` 与 `docs/business-models/`（首版实现时同步发布）|
| v1.4 | 2026-06-01 | **架构对齐本地 opencli 源码**：发现 `/Users/lylyyds/Desktop/opencli/clis/douyin/` 已实现 `search.js` + `user-videos.js`（带 `--with_comments`），不存在独立 `comment.js`。**§3.1 / §3.2 / §2.4.2 / §3.7 全部重写**为基于源码的「`sec_uid` 模式（推荐）+ `keyword` 模式（备选）」双路径架构；发现 `search.js` 输出 `plays/comments/shares=0` 的硬限制——通过 `target_sec_uids` + `user-videos --with_comments` 直接拿到评论，绕开此限制。**新增 §3.6.1 Task/TaskResult TS 接口** + §3.6 反馈驱动任务生成逻辑。|
| v1.4 | 2026-06-01 | **真正闭环**：修复反馈回路断裂——① §3.3 Lead 接口新增 source_keyword / source_video_id / detected_at 供全链路归因；② §3.4 generateHook() 读取 weekly-insights.json 最优钩子风格（回路 2 闭合）；③ §3.6 任务生成器读取 persona 价值排序 + 最佳互动时段（回路 3/4 闭合）；④ §3.10 新增 recordTouchpoint() 全链路触达埋点 + §3.10.1 触达结果回填机制；⑤ §3.11 事件结构扩展支持转化路径归因 + 5 条回路同时生效；⑥ §4 依赖图更新；⑦ §7 验收标准增加 5 条回路验证项；⑧ 删除 §14/§15/§16 非设计内容 |
| v1.5 | 2026-06-01 | **定型修复**：① §3.3 Lead 接口新增 status + hook_style 字段（修复任务生成器无法按状态机推进 + 钩子风格归因丢失）；② §3.5 CRM 标准字段映射新增 hook_style / source_keyword / source_video_id；③ §13.4.1 LeadStatus 支持业务方自定义状态（`string & {}`）；④ §3.11 子功能「钩子风格 A/B」修正为「钩子风格追踪」（与实际实现对齐）；⑤ §3.10.1 新增触达结果回填机制（opened / replied / booked / no_response 的触发条件 + 数据来源）|
| v1.6 | 2026-06-01 | **全自动化**：① §1.2 从「半自动」改为「全自动」——引导任务由登录态浏览器自动执行，人只需看日报 + 处理告警；② §1.3 移除「不做自动私信」非目标；③ §2.1/§2.2 架构图和数据流更新为自动执行；④ §3.6 新增 §3.6.5 自动执行引擎（task-executor 模块）——浏览器操作映射 + 可选钩子审核模式；⑤ §3.6.2 互动效果感知改为系统自动检测（不再依赖人工标记）；⑥ §3.7 编排脚本新增步骤 ⑦ 自动执行；⑦ §5.2 限速规则从「人工保护」改为「自动执行的安全边界」；⑧ §13.1 目录结构新增 task-executor / conversion-engine / feedback-analyzer |
| v1.7 | 2026-06-01 | **蓝本定型**：补齐 6 个接口级空白——① §3.6.1 新增 Task / TaskAction / TaskResult 接口；② §3.6.5 新增 ExecutionResult / RiskSignal / SafetyConfig 接口；③ §3.6.5 新增 browserExecute() 函数签名；④ §2.4.2 新增 channels.yaml 完整 schema；⑤ §2.4.3 新增 conversion.yaml 完整 schema；⑥ §2.4.1 新增 profile.yaml 完整 schema |
| v1.8 | 2026-06-01 | **闭环终审修复**：① §3.6.1 新增状态转移表 + buildTask() 完整定义（含 current_state → next_action 映射 + 24h 冷却期 + opt_out 检查）；② §3.7 CRON 从 3 个补全到 7 个（+转化日报/反馈分析/优化建议/再激活）；③ §3.11 新增冷启动行为定义（weekly-insights.json 不存在时各回路的 fallback 值 + loadLatestInsights() 函数）；④ §3.3 Lead 接口新增 opt_out / last_task_executed_at / last_task_result / last_response_text / execution_count / response_count 字段；⑤ §3.6.3 新增 opt_out 检测机制（拒绝信号词匹配）；⑥ §3.5 CRM 字段映射新增 6 个互动效果字段；⑦ §2.4.2 channels.yaml 新增 weight_min / weight_max / weight_cooldown_weeks 防震荡参数；⑧ §3.6.5 hook_review 默认值设为 true（前 2 周建议开启）|

---

### 13.4 附录：Adapter 接口规范（完整版）

> 详细接口定义。如需写自定义 adapter 或深入理解，参阅本节。

#### 13.4.1 CRM Adapter

**接口定义**：`src/adapters/crm/base.ts`

```typescript
export interface SyncResult {
  synced: number;
  failed: number;
  errors: Array<{ cid: string; error: string }>;
}

export interface LeadFilter {
  status?: LeadStatus[];
  persona?: string[];
  intent_score_gte?: number;
  created_after?: Date;
  created_before?: Date;
  has_open_task?: boolean;
}

export interface CRMAdapter {
  /** 同步一批 leads 到 CRM；增量去重由内部完成 */
  syncLeads(leads: Lead[]): Promise<SyncResult>;

  /** 根据 cid 查询单条 lead */
  getLead(cid: string): Promise<Lead | null>;

  /** 更新 lead 状态 */
  updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void>;

  /** 列出 lead，支持过滤 */
  listLeads(filter?: LeadFilter): Promise<Lead[]>;

  /** 健康检查 */
  ping(): Promise<boolean>;
}

// 内置状态（框架默认）
type BuiltInStatus =
  | '新发现'
  | '已关注'
  | '已互动'
  | '已加好友'
  | '已加微'
  | '已预约'
  | '已成交'
  | '已流失'
  | '沉默'
  | '已再激活';

// 🆕 支持业务方自定义状态（来自 business/conversion.yaml → lifecycle_states）
// 例：'已诊断' | '已试用' | '已咨询' | '续约' 等任意业务自定义状态
// TypeScript 提示：`string & {}` 允许任意字符串，同时保留 IDE 对内置状态的自动补全
export type LeadStatus = BuiltInStatus | (string & {});
```

**内置实现**：
| 文件 | 用途 |
|---|---|
| `src/adapters/crm/feishu.ts` | 飞书多维表（生产环境推荐）|
| `src/adapters/crm/notion.ts` | Notion database |
| `src/adapters/crm/airtable.ts` | Airtable |
| `src/adapters/crm/csv.ts` | 本地 CSV（开发 / 调试用）|

#### 13.4.2 LLM Provider Adapter

**接口定义**：`src/adapters/llm/base.ts`

```typescript
export interface LLMOptions {
  temperature?: number;     // 默认 0.3
  maxTokens?: number;       // 默认 1000
  responseFormat?: 'json' | 'text';  // 默认 'text'
  stop?: string[];
}

export interface LLMProvider {
  complete(prompt: string, opts?: LLMOptions): Promise<string>;
  embed(text: string): Promise<number[]>;

  // 能力描述（用于自动选择 + 健康检查）
  readonly capabilities: {
    jsonMode: boolean;
    functionCalling: boolean;
    vision: boolean;
    contextWindow: number;
  };

  // 定价（用于 ROI / 成本估算）
  readonly pricing: {
    inputPerMTok: number;    // 美元 / 百万 token
    outputPerMTok: number;
    embedPerMTok: number;
  };

  /** 健康检查 + 计费 sanity */
  ping(): Promise<{ ok: boolean; latency_ms: number }>;
}
```

**内置实现**：
| 文件 | 模型 | 备注 |
|---|---|---|
| `src/adapters/llm/openai.ts` | gpt-4o-mini / gpt-4o | 质量最高，价格中等 |
| `src/adapters/llm/deepseek.ts` | deepseek-v3 | 默认；国内直连，便宜 |
| `src/adapters/llm/anthropic.ts` | claude-3-5-sonnet | 长文本场景 |
| `src/adapters/llm/ollama.ts` | qwen2.5 / llama3.1 本地模型 | 完全免费，需本地 GPU |

**降级机制**（用户配置）：
```yaml
llm:
  provider: deepseek
  fallback:
    - provider: openai
      model: gpt-4o-mini
    - provider: ollama
      model: qwen2.5
```
当主 provider 失败时按顺序降级。

#### 13.4.3 Channel Adapter

**接口定义**：`src/adapters/channel/base.ts`

```typescript
export interface SearchQuery {
  keywords: string[];
  sort?: 'hot' | 'time';
  limit: number;
  filters?: {
    minLikes?: number;
    minComments?: number;
    maxAgeDays?: number;
  };
}

export interface Video {
  id: string;
  desc: string;
  author: { nickname: string; uid: string; follower_count: number; };
  stats: { play_count: number; digg_count: number; comment_count: number; };
  create_time: number;
  url: string;
}

export interface CommentOptions {
  limit: number;
  sort?: 'hot' | 'time';
  maxLength?: number;
  filters?: {
    minLength?: number;
    excludeMarketing?: boolean;
  };
}

export interface Comment {
  cid: string;
  text: string;
  user: { nickname: string; uid: string; follower_count: number; signature: string; };
  digg_count: number;
  create_time: number;
  reply_count: number;
}

export interface RateLimits {
  search_per_hour: number;
  comment_per_hour: number;
  friend_request_per_day: number;
  dm_per_day: number;
}

export interface ChannelAdapter {
  readonly name: string;        // 'douyin' | 'xiaohongshu' | ...
  readonly rateLimits: RateLimits;

  search(query: SearchQuery): Promise<Video[]>;
  getComments(videoId: string, opts?: CommentOptions): Promise<Comment[]>;

  /** 健康检查 + 登录态校验 */
  ping(): Promise<{ ok: boolean; loggedIn: boolean }>;
}
```

**V1 实现**：
- `src/adapters/channel/douyin.ts` —— 内部组合 `opencli douyin search` / `opencli douyin comment`（见 §3.1 / §3.2）

**V2 扩展**（用户可贡献）：
- `src/adapters/channel/xiaohongshu.ts` —— 小红书
- `src/adapters/channel/bilibili.ts` —— B站
- `src/adapters/channel/kuaishou.ts` —— 快手
- `src/adapters/channel/wechat-channels.ts` —— 视频号

放在 `business/adapters/channel/` 目录，启动时自动加载。

#### 13.4.4 Notifier Adapter

**接口定义**：`src/adapters/notifier/base.ts`

```typescript
export interface NotificationMessage {
  title?: string;
  body: string;             // 支持 markdown
  level?: 'info' | 'warning' | 'critical';
  actions?: Array<{ label: string; url: string }>;
}

export interface SendResult {
  ok: boolean;
  message_id?: string;
  error?: string;
}

export interface Notifier {
  readonly name: string;        // 'wechat' | 'feishu' | 'email' | 'slack'
  send(message: NotificationMessage): Promise<SendResult>;
}
```

**内置实现**：
| 文件 | 渠道 | 备注 |
|---|---|---|
| `src/adapters/notifier/wechat.ts` | 个人微信 | 通过 `opencli weixin` 发送（v1）|
| `src/adapters/notifier/feishu.ts` | 飞书机器人 | WebHook |
| `src/adapters/notifier/email.ts` | 邮件 | SMTP |
| `src/adapters/notifier/slack.ts` | Slack | WebHook |

#### 13.4.5 Embedding Provider

**接口定义**：`src/adapters/embeddings/base.ts`

```typescript
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly model: string;
}
```

**内置实现**：
- `text-embedding-3-small` (OpenAI) —— 1536 维，默认
- `nomic-embed-text` (Ollama) —— 768 维，本地免费
- `bge-small-zh` (本地) —— 512 维，中文优化

#### 13.4.6 自定义 Adapter 开发指南

**3 步走**：

1. **继承接口**：在 `business/adapters/<type>/my-adapter.ts` 实现接口
2. **导出类**：用 `export class MyAdapter implements XxxAdapter`
3. **自动加载**：`src/adapters/registry.ts` 启动时扫描 `business/adapters/` 目录自动注册

**示例**（一个自定义的 HubSpot CRM Adapter）：
```typescript
// business-randian-hubspot/crm/my-hubspot.ts
import type { CRMAdapter, Lead, SyncResult } from 'explore-star/adapters/crm';

export class HubSpotCRM implements CRMAdapter {
  async syncLeads(leads: Lead[]): Promise<SyncResult> {
    // 实现 HubSpot API 调用
  }
  // ... 其他方法
}
```

`business/profile.yaml` 中启用：
```yaml
crm:
  type: custom
  module: ./adapters/crm/my-hubspot.ts
```

详细开发文档：`docs/adapters.md`（Day 10 写）

