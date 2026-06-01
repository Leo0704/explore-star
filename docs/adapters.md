# Adapter 开发指南

## 架构概述

探星使用 Adapter 模式解耦各个模块，允许用户替换内置实现或添加新平台。

```
探星
  ├── LLM Provider    → DeepSeek / OpenAI / Anthropic / Ollama
  ├── Channel         → 抖音（V1）/ 小红书（B2）/ B站（V2）
  ├── CRM             → 飞书 / Notion / Airtable / CSV
  ├── Notifier        → 微信 / 飞书 / 邮件 / Console
  └── Embeddings      → OpenAI / 本地 bge
```

## 实现一个新 Adapter

### 1. 定义接口

所有 Adapter 接口在 `src/core/types.ts` 中定义：

```typescript
// LLM Provider
interface LLMProvider {
  complete(prompt: string, opts?: LLMOptions): Promise<string>;
  embed(text: string): Promise<number[]>;
  readonly capabilities: { jsonMode: boolean; functionCalling: boolean; ... };
  ping(): Promise<{ ok: boolean; latency_ms: number }>;
}

// CRM
interface CRMAdapter {
  syncLeads(leads: Lead[]): Promise<SyncResult>;
  getLead(cid: string): Promise<Lead | null>;
  updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void>;
  listLeads(filter?: LeadFilter): Promise<Lead[]>;
  ping(): Promise<boolean>;
}
```

### 2. 创建实现

```typescript
// src/adapters/crm/my-custom.ts
import type { CRMAdapter, Lead, SyncResult, LeadFilter } from '../../core/types.js';

export class MyCustomCRM implements CRMAdapter {
  async syncLeads(leads: Lead[]): Promise<SyncResult> {
    // 实现同步逻辑
  }

  async getLead(cid: string): Promise<Lead | null> {
    // 实现获取逻辑
  }

  async updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void> {
    // 实现状态更新
  }

  async listLeads(filter?: LeadFilter): Promise<Lead[]> {
    // 实现列表查询
  }

  async ping(): Promise<boolean> {
    // 实现健康检查
    return true;
  }
}
```

### 3. 注册 Adapter

在 `business/adapters/` 目录下创建 `.ts` 文件，启动时自动加载：

```typescript
// business/adapters/my-custom-crm.ts
import { registerCRM } from '../../adapters/registry.js';
import { MyCustomCRM } from '../../adapters/crm/my-custom.js';

registerCRM('my_custom', new MyCustomCRM(config));
```

### 4. 使用新 Adapter

在 `profile.yaml` 中指定：

```yaml
crm:
  type: my_custom
  config:
    # 你的配置
```

## 内置 Adapter 列表

| 类型 | 名称 | 说明 |
|---|---|---|
| LLM | `openai` | OpenAI GPT 系列 |
| LLM | `deepseek` | DeepSeek V3 |
| LLM | `anthropic` | Anthropic Claude |
| LLM | `ollama` | 本地 Ollama |
| CRM | `feishu` | 飞书多维表 |
| CRM | `notion` | Notion Database |
| CRM | `airtable` | Airtable |
| CRM | `csv` | 本地 CSV（开发用）|
| Channel | `douyin` | 抖音（V1）|
| Notifier | `console` | 控制台输出 |
| Notifier | `feishu` | 飞书机器人 |
| Notifier | `email` | 邮件 |
| Notifier | `wechat` | 微信（V2）|

## 测试 Adapter

```typescript
import { registerBuiltins } from './adapters/registry.js';
import { getCRM } from './adapters/registry.js';

await registerBuiltins();
const crm = getCRM();
const ok = await crm.ping();
console.log('CRM ping:', ok);
```