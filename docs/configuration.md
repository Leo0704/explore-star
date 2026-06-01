# 配置详解

## profile.yaml（业务核心配置）

```yaml
business:
  name: string                    # 业务名称
  value_prop: string              # 价值主张（一句话）
  description?: string            # 业务描述

target_personas:                  # 目标人设
  - id: string                    # 人设 ID
    name: string                  # 人设名称
    description?: string
    typical_pain_points: string[] # 典型痛点
    value_score?: number           # 价值评分（默认 5.0）

intent_signals: string[]          # 意图信号词

buying_stages?:                    # 购买阶段
  - id: string
    name: string
    description: string

llm:
  provider: openai | deepseek | anthropic | ollama
  model: string                   # 模型名
  api_key_env: string             # 环境变量名
  temperature?: number            # 默认 0.3
  max_tokens?: number             # 默认 1000
  base_url?: string               # 自定义 API URL

crm:
  type: feishu | notion | airtable | csv | custom
  config:                         # CRM 连接配置

hook_config?:
  style?: string                  # 默认风格
  max_length?: number             # 最大字数（默认 30）
  language?: string              # 输出语言

feedback_config?:
  auto_apply?:
    keyword_weight?: boolean      # 默认 true
    hook_style?: boolean         # 默认 false
    persona_value?: boolean       # 默认 false
    interaction_time?: boolean    # 默认 false
```

## channels.yaml（数据源配置）

```yaml
source:
  mode: sec_uid | keyword | both  # 默认 sec_uid

search:
  keywords:
    "AI 客服":
      weight: 1.0
  limit_per_keyword?: number      # 默认 10，上限 30

target_sec_uids:
  - "MS4wLjABAAAAxxx"             # KOL sec_uid
  user_videos_limit?: number       # 默认 20
  comment_limit?: number          # 默认 10

filters:
  min_likes?: number             # 默认 100
  max_age_days?: number          # 默认 30

comment_filters:
  min_length?: number            # 默认 4
  exclude_emoji_only?: boolean   # 默认 true
  exclude_punctuation_only?: boolean
  exclude_marketing?: boolean    # 默认 true
```

## conversion.yaml（转化配置）

```yaml
lifecycle_states:
  - id: string
    name: string
    is_terminal: boolean         # 终态？

success_states:
  - "closed"                      # 算成功的状态

post_add_asset:
  type: pdf | link | image
  name: string
  path: string                   # 本地路径或 URL

booking_url: string              # 转化入口

message_template: |              # 推送话术（支持 {{nickname}}）
  {{nickname}} 您好...

booking_provider:
  type: feishu_calendar | webhook | manual
  config: ...

reactivation:
  dormant_days?: number          # 默认 30
  max_attempts?: number         # 默认 1
  message_template: string

cost_per_lead?: number           # ROI 计算用
revenue_field?: string           # CRM 中的营收字段
```

## 安全配置（config/safety.json）

```json
{
  "rate_limits": {
    "douyin.search.calls_per_hour": 10,
    "douyin.friend_request.per_day": 5,
    "douyin.dm.per_day": 10
  },
  "daily_budget": {
    "engagement_actions": 20
  },
  "fatal_signals": [
    "auth_wall_detected",
    "captcha_triggered_3_times_in_1h"
  ]
}
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API Key（推荐） |
| `OPENAI_API_KEY` | OpenAI API Key |
| `FEISHU_APP_ID` | 飞书 App ID |
| `FEISHU_APP_SECRET` | 飞书 App Secret |
| `FEISHU_CALENDAR_ID` | 飞书日历 ID（预约监听用） |