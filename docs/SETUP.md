# 探星配置指南

跑通探星需要配置 **4 个文件 + 1 个目录 + 1 个环境变量**。按顺序来，10 分钟搞定。

---

## 第 1 步：你是干什么的？→ `profile.yaml`

```yaml
business:
  name: "你的业务名"                    # 必填
  value_prop: "你卖什么（一句话）"       # 必填

target_personas:                        # 必填，至少 1 个
  - id: my_customer
    name: "你的目标客户叫什么"
    typical_pain_points:
      - "他们有什么痛点 1"
      - "他们有什么痛点 2"

intent_signals:                         # 必填，LLM 用这些词判断评论是否有意向
  - "关键词 1"
  - "关键词 2"
  - "求推荐"

llm:
  provider: deepseek                    # 必填：openai / deepseek / anthropic / ollama
  model: deepseek-v3                    # 必填
  api_key_env: DEEPSEEK_API_KEY         # 必填：环境变量名
```

---

## 第 2 步：去哪找客户？→ `channels.yaml`

两种方式，**选一种填**：

### 方式 A：找特定 KOL 的评论区（推荐）

```yaml
source:
  mode: "sec_uid"

target_sec_uids:
  sec_uids:
    - "MS4wLjABAAAAxxxxxx"              # KOL 1 的 sec_uid
    - "MS4wLjABAAAAyyyyyy"              # KOL 2 的 sec_uid
    # ... 至少填 5 个
```

**怎么拿 sec_uid**：打开 KOL 抖音主页（web 端），URL 末尾那段就是。
例如 `https://www.douyin.com/user/MS4wLjABAAAAxxxxxx` → sec_uid = `MS4wLjABAAAAxxxxxx`

### 方式 B：搜关键词

```yaml
source:
  mode: "keyword"

search:
  keywords:
    "你的关键词 1":
      weight: 1.0
    "你的关键词 2":
      weight: 1.0
```

---

## 第 3 步：找到的客户放哪？→ `crm.yaml`

最简单的方式——**先用 CSV**（零配置，数据存本地文件）：

```yaml
crm:
  type: csv
```

等跑通了再换飞书/Notion：

```yaml
crm:
  type: feishu                          # 或 notion / airtable
  config:
    app_id_env: FEISHU_APP_ID           # 环境变量名
    app_secret_env: FEISHU_APP_SECRET
    table_id: "你的表 ID"
```

---

## 第 4 步：你的知识库 → `knowledge/` 目录

**这是 RAG 钩子生成器的数据源**——LLM 会引用里面的案例/话术来写钩子。没有这个目录，钩子质量会很差。

```
knowledge/
├── 01-cases/                           # 你做过的案例（2-3 个）
│   ├── case-01.md                      #   客户背景 + 需求 + 你的方案 + 结果
│   └── case-02.md
├── 02-methodology/                     # 你的方法论（1 个）
│   └── methodology.md                  #   你怎么做这个业务
├── 03-hooks/                           # 话术模板（2-3 个）
│   ├── hook-template-reply.md          #   评论回复话术
│   └── hook-template-dm.md             #   私信话术
└── 04-faq/                             # 常见问题（1-2 个）
    └── faq-01.md                       #   客户问什么 + 你怎么答
```

**MVP 最少 6 个 markdown 文件**，每个 100-300 字就行。

---

## 第 5 步：环境变量

```bash
# 必须
export DEEPSEEK_API_KEY="sk-..."

# 如果用飞书 CRM
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"

# 如果用飞书日历做预约监听（转化引擎需要）
export FEISHU_CALENDAR_ID="xxx"
export FEISHU_WEBHOOK_SECRET="xxx"
```

---

## 第 6 步：转化路径（可选，加微后再配）

等你真的有人加微信了，再改 `conversion.yaml`：

```yaml
post_add_asset:                         # 加微后发什么
  type: pdf
  name: "你的资料名"
  path: "./assets/your-file.pdf"

booking_url: "https://你的预约链接"

message_template: |                     # 加微后说什么
  {{nickname}} 您好，发了份资料给您。
  有需要可以约个时间聊聊：{{booking_url}}
```

---

## 第 7 步：安全限速（不用改）

`config/safety.json` 有默认值，**不用动**：

- 每天最多 5 个好友申请
- 每天最多 10 条私信
- 每个动作间隔 3-8 秒
- 紧急停止开关：`touch config/EMERGENCY_STOP`

---

## 第 8 步：安装定时任务

`schedule.yaml` 已配好默认时间，**不用改**。一行命令安装：

```bash
npx explore-star schedule --install --business=.
```

安装后的效果：

| 时间 | 自动做什么 |
|---|---|
| 每天 09:00 | 跑主流程（搜评论 → 分析 → 执行任务 → 推送早报） |
| 每天 18:00 | 推送晚报 |
| 每天 22:00 | 推送转化日报 |
| 每周日 03:00 | 跑反馈分析 |
| 每周一 09:00 | 推送优化建议 |
| 每月 1 日 10:00 | 再激活沉默客户 |
| 每 6 小时 | 健康检查 |

其他命令：

```bash
# 查看已安装的任务
npx explore-star schedule --list

# 卸载
npx explore-star schedule --uninstall

# 改时间：编辑 schedule.yaml 后重新 install
```

---

## 启动

```bash
# 检查配置
npx explore-star doctor --business=.

# 试跑（不执行，只看输出）
npx explore-star run --business=. --dry-run

# 真跑
npx explore-star run --business=.

# 安装定时任务（之后每天自动跑）
npx explore-star schedule --install --business=.
```

---

## 配置清单

| # | 配什么 | 文件 | 必须？ | 改什么 |
|---|---|---|---|---|
| 1 | 你的业务 | `profile.yaml` | ✅ | name / value_prop / target_personas / intent_signals |
| 2 | 去哪找客户 | `channels.yaml` | ✅ | sec_uids 或 keywords |
| 3 | 客户放哪 | `crm.yaml` | ✅ | type（先用 csv） |
| 4 | 通知渠道 | `notifier.yaml` | ✅ | default（先用 console） |
| 5 | 你的知识库 | `knowledge/` | ✅ | 6-8 个 markdown |
| 6 | 环境变量 | shell | ✅ | DEEPSEEK_API_KEY |
| 7 | 转化路径 | `conversion.yaml` | 🟡 | 有转化物料时再配 |
| 8 | 安全限速 | `config/safety.json` | 🟡 | 不用改 |
| 9 | 定时任务 | `schedule.yaml` | 🟡 | 不用改，`schedule --install` 自动安装 |
