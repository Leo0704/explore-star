# 探星（Explore-Star）

> 抖音评论截流自动化框架 —— 通过 OpenCLI + LLM 自动发现潜在客户，提供从「侦察 → 引导 → 转化 → 反馈」全流程编排支持。

![status](https://img.shields.io/badge/status-v1.4-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%3E%3D20-blue)

## ✨ 特性

- **🔍 侦察**：按目标 KOL（推荐）或关键词从抖音拉视频+评论
- **🤖 意图分析**：用 LLM 识别高意向潜在客户，模板化 prompt（业务无关）
- **📚 RAG 钩子生成**：基于业务知识库生成自然、有温度的话术
- **🧭 引导引擎**：状态机 + 互动感知 + 智能放弃 + 再激活（贝叶斯平滑算法）
- **💰 转化引擎**：加微后自动推物料 + 转化日报 + ROI 计算
- **🔁 反馈闭环**：每周自动分析关键词权重、钩子风格、Persona 价值

## 🚀 5 分钟上手

```bash
# 1. 安装
git clone <repo>
cd explore-star
npm install

# 2. 设置 LLM Key
export DEEPSEEK_API_KEY=sk-...

# 3. 复制示例业务
npx explore-star init my-business

# 4. 编辑配置（改 3-5 个字段）
vim my-business/profile.yaml

# 5. 检查环境
npx explore-star doctor

# 6. 试跑
npx explore-star run --business=./my-business --dry-run
```

## 🏗️ 架构

4 阶段闭环：

```
侦察 → 引导 → 转化 → 反馈 ↻
                ↑_______|
```

详见 [`docs/superpowers/specs/2026-06-01-explore-star-design.md`](docs/superpowers/specs/2026-06-01-explore-star-design.md)

## 📁 目录结构

```
explore-star/
├── src/                           # 框架核心代码（业务无关）
│   ├── core/
│   │   ├── types.ts               # 完整 TypeScript 类型定义
│   │   └── business-profile.ts    # 业务配置加载与校验
│   ├── adapters/
│   │   ├── registry.ts            # Adapter 注册中心
│   │   ├── llm/                   # OpenAI / DeepSeek
│   │   ├── crm/                   # CSV / 飞书
│   │   ├── channel/               # 抖音（基于 opencli 源码）
│   │   ├── notifier/              # Console / 微信 / 飞书 WebHook
│   │   └── embeddings/            # OpenAI Embeddings
│   ├── modules/
│   │   ├── intent-analyzer/       # §3.3 意图分析
│   │   ├── nurture-engine/        # §3.6 引导引擎
│   │   ├── conversion-engine/     # §3.10 转化引擎
│   │   └── feedback-analyzer/     # §3.11 反馈分析器
│   ├── rag/                       # §3.4 RAG 知识库 + 钩子生成
│   ├── orchestration/
│   │   └── run-daily.ts           # §3.7 编排器
│   └── cli/
│       └── index.ts               # CLI 入口
├── business.example/燃点-FDE/     # 默认示例业务（脱敏）
├── docs/
│   ├── superpowers/specs/         # 完整设计文档
│   └── algorithms/                # 算法 spec
├── tests/                         # 单元测试（35 个测试，100% 通过）
├── config/
│   └── safety.json                # 5 铁律 + 限速配置
├── package.json
├── tsconfig.json
└── README.md                      ← 本文件
```

## 🧪 测试

```bash
npx vitest run
```

**当前状态**：35 个测试全部通过。

覆盖：
- `DouyinChannel` adapter（17 个测试）：search / getUserVideos / ping / 错误处理
- `NurtureEngine`（12 个测试）：状态机 / 互动感知 / 智能放弃 / 再激活 / 优先级
- `FeedbackAnalyzer` 算法（6 个测试）：贝叶斯平滑 / 风格切换门槛 / 权重钳位

## 🛠️ 依赖

| 依赖 | 用途 | 是否必须 |
|---|---|---|
| Node.js ≥ 20 | 运行时 | ✅ |
| `opencli` ≥ 1.8.0 | 抖音数据采集 | ✅ |
| Chrome + 抖音登录态 | Cookie 复用 | ✅ |
| `DEEPSEEK_API_KEY` | LLM（推荐）/ `OPENAI_API_KEY` 备选 | ✅ |
| `OPENAI_API_KEY` | Embeddings（用于 RAG） | 可选 |
| 飞书开放平台应用 | CRM 同步（生产推荐） | 可选 |

## 🔒 合规

- ✅ 只抓公开视频元数据
- ✅ 评论分析**不上传**给 LLM 训练（API 禁用训练）
- ✅ 私信内容**人工撰写**，程序不自动发送
- ❌ 不做群发垃圾私信、骚扰、虚假宣传
- ❌ 不把抓取数据用于训练 AI

详见设计文档 §5.6。

## 📊 框架效果（业务无关指标）

| 维度 | 目标 |
|---|---|
| 侦察 | 50 视频 / 5000 评论 / 100-200 高意向 lead |
| 引导 | 5-20 任务 / 天，3 次 0 回应自动降级 |
| 转化 | 转化日报含 ROI、Hot Leads、At Risk |
| 反馈 | 学习期 14 天后开始调优；自动调优关键词权重 |
| 月成本 | < 500 元（LLM + 飞书 API） |

**业务专属效果**（营收/ROI/LTV）见各业务的 README——框架**不假设**任何具体数字。

## 📜 许可证

MIT

## 🤝 贡献

欢迎贡献：
- 新 Channel Adapter（小红书 / B站 / 视频号）
- 新 CRM Adapter（Notion / Airtable / HubSpot）
- 新 LLM Provider（Anthropic / Ollama / 通义千问）
- 新业务示例（律师 / 咨询 / 设计）

详见 `CONTRIBUTING.md`（待补）。
