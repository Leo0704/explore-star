# 探星快速入门

> 本节为旧版精简概览。完整配置说明、字段释义与样例已迁移至 [`/SETUP.md`](../../SETUP.md)，
> 请以 SETUP.md 为单一真理源（Single Source of Truth）。

> 5 分钟启动抖音评论截流自动化

## 前置要求

- Node.js >= 20
- npm >= 9
- 抖音账号（需要已登录状态的 Chrome Profile）

## 快速开始

### 1. 安装

```bash
git clone https://github.com/xxx/explore-star
cd explore-star
npm install
```

### 2. 初始化业务

```bash
npx explore-star init my-business
cd my-business
```

### 3. 配置业务参数

编辑 `profile.yaml`：

```yaml
business:
  name: "你的业务名"
  value_prop: "你的价值主张"
target_personas:
  - id: your_persona
    name: "目标人设"
    typical_pain_points:
      - "痛点1"
      - "痛点2"
llm:
  provider: deepseek
  model: deepseek-v3
  api_key_env: DEEPSEEK_API_KEY
```

设置环境变量：

```bash
export DEEPSEEK_API_KEY=your_api_key
```

### 4. 检查环境

```bash
npx explore-star doctor
```

### 5. 试跑（dry-run）

```bash
npx explore-star run --business=./my-business --dry-run
```

## 核心命令

| 命令 | 说明 |
|---|---|
| `init <name>` | 初始化新业务目录 |
| `doctor` | 检查环境配置 |
| `run --business=<dir>` | 跑每日主流程 |
| `analyze --business=<dir>` | 单跑意图分析 |
| `nurture --business=<dir>` | 单跑引导引擎 |
| `convert --business=<dir>` | 单跑转化引擎（日报） |
| `insights --business=<dir>` | 跑反馈分析器 |
| `reactivate --business=<dir>` | 再激活沉默客户 |

## 目录结构

```
my-business/
├── profile.yaml        # 业务核心配置（必读）
├── channels.yaml        # 抖音数据源配置
├── conversion.yaml      # 转化路径配置
├── crm.yaml            # CRM 配置
├── prompts/            # 自定义 LLM prompt
└── knowledge/          # RAG 知识库
```

## 常见问题

### Q: 报错 "抖音登录墙"

需要重新登录抖音：在 Chrome 打开抖音网页，确保登录状态。

### Q: 怎么找 sec_uid？

打开目标 KOL 的抖音主页，URL 末尾那段就是 sec_uid，如 `https://www.douyin.com/user/MS4wLjABAAAA...`

### Q: 怎么修改关键词权重？

运行 `npx explore-star insights` 生成周报后，参考 `data/feedback/weekly-insights.json` 中的建议。

## 下一步

- [配置详解](./configuration.md)
- [Adapter 开发](./adapters.md)
- [FAQ](./faq.md)
- [合规说明](./compliance.md)