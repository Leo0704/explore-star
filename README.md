# 燃点 FDE 业务示例

> 这是探星框架的**默认示例业务**——作者 lylyyds 的真实业务脱敏版。
>
> **重要**：本目录是**配置参考**，不是框架代码的一部分。框架核心代码在 `/Users/lylyyds/Desktop/explore-star/src/`。

## 业务概览

- **业务名**：燃点 FDE
- **价值主张**：派工程师到企业现场做定制化 AI 落地
- **目标客户**：自媒体矩阵 / 电商 / 在线教育 等小微企业
- **典型单客价值**：5-15 万元（项目交付）
- **复购率**：98%

## 目录结构

```
燃点-FDE/
├── README.md              ← 本文件
├── profile.yaml           ← 业务画像（§2.4.1）
├── channels.yaml          ← 渠道配置（§2.4.2）：关键词 + 目标 KOL
├── crm.yaml               ← CRM 配置（§3.5）：飞书多维表字段映射
├── conversion.yaml        ← 转化配置（§2.4.3）：生命周期 + 物料 + 预约
├── prompts/
│   ├── intent-system.md   ← §3.3 意图分析 system prompt
│   ├── intent-user.md     ← §3.3 意图分析 user prompt 模板
│   ├── hook-reply.md      ← §3.4 钩子生成（评论回复）模板
│   └── hook-dm.md         ← §3.4 钩子生成（私信）模板
├── knowledge/             ← §3.4 RAG 知识库（待补充）
└── assets/                ← §3.10 获客物料（待补充）
```

## 业务方上手

### 1. 复制本目录

```bash
npx explore-star init my-business
# 自动从 business.example/燃点-FDE/ 复制模板
# 复制到 ./my-business/
```

### 2. 修改 3-5 个字段

**最少必改的字段**（`my-business/profile.yaml`）：

```yaml
business:
  name: "你的业务名"        # ← 必改
  value_prop: "你的价值主张"  # ← 必改

target_personas:           # ← 必改（替换为你的目标人设）
  - id: your_persona_1
    name: "你的目标人设 1"
    typical_pain_points: ["痛点 A", "痛点 B"]

crm:
  type: feishu             # ← 可改（notion / airtable / csv）
  config:
    app_id_env: FEISHU_APP_ID
    app_secret_env: FEISHU_APP_SECRET
    table_id: "你的表 ID"   # ← 必改
```

### 3. 跑起来

```bash
npx explore-star doctor          # 检查环境
npx explore-star run --business=./my-business --dry-run
npx explore-star run --business=./my-business
```

## 与燃点 FDE 业务相关的隐私

本目录已脱敏：
- ❌ 真实 KOL sec_uid 列表为空（业务方需要自己填）
- ❌ 真实客户案例已脱敏或留空（业务方填自己的）
- ❌ 真实 CRM table_id 替换为示例
- ❌ 飞书 app_id / app_secret 改为环境变量引用

## 业务效果表（首版实现时同步发布）

> 本表的实现细节见 `docs/business-models/lylyyds-燃点-FDE.md`。
> 框架本身**不假设**任何业务效果——这个表仅作作者业务的实际数据记录。

| 阶段 | 指标 | 保守目标 | 乐观目标 |
|---|---|---|---|
| 侦察 | 月新增意向 lead | 1500-2500 | 3000-5000 |
| 引导 | 月加微信 | 30-50 | 80-150 |
| 转化 | 月成交 | 1-3 | 3-8 |
| 转化 | 月营收 | 5-45 万 | 15-240 万 |
| ROI | 单 LLM 成本 | < 50 元 | < 15 元 |
| ROI | **整体 ROI** | **100x-300x** | **500x-1500x** |
