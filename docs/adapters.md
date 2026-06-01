# Adapter 开发指南

## 架构概述

探星使用 Adapter 模式解耦各个模块，允许用户替换内置实现或添加新平台。

```
探星
  ├── LLM Provider    → DeepSeek / OpenAI / Anthropic / Ollama
  ├── Channel         → 抖音（V1）/ 小红书（V2）/ B站（V2）
  ├── CRM             → 飞书 / Notion / Airtable / CSV
  ├── Booking         → 飞书日历 / WebHook / 手动（V2 抽象）
  ├── Embeddings      → OpenAI（V1.4 独立实现）
  └── Notifier        → 微信 / 飞书 / 邮件 / Console
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

// Embeddings（V1.4 独立于 LLM 抽象，因 input/response 形状不同）
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly model: string;
}

// CRM
interface CRMAdapter {
  syncLeads(leads: Lead[]): Promise<SyncResult>;
  getLead(cid: string): Promise<Lead | null>;
  updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void>;
  listLeads(filter?: LeadFilter): Promise<Lead[]>;
  ping(): Promise<boolean>;
}

// Booking（§13.4 补充）—— 监听预约来源，产生 BookingEvent 流
interface BookingProvider {
  watchBookings(): AsyncIterable<BookingEvent>;
  ping(): Promise<boolean>;
}

interface BookingEvent {
  cid: string;
  type: 'booked' | 'cancelled' | 'reminded';
  scheduledAt?: string;           // ISO 8601
  channel: string;                // 'feishu_calendar' / 'webhook' / ...
  occurredAt: string;             // ISO 8601
  metadata?: Record<string, unknown>;
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
| Embedding | `openai` | OpenAI `text-embedding-3-small`（1536 维）|
| CRM | `feishu` | 飞书多维表 |
| CRM | `notion` | Notion Database |
| CRM | `airtable` | Airtable |
| CRM | `csv` | 本地 CSV（开发用）|
| Channel | `douyin` | 抖音（V1）|
| Booking | `feishu_calendar` | 飞书日历轮询（默认 60s）|
| Booking | `webhook` | 通用 WebHook 接收（内存队列）|
| Notifier | `console` | 控制台输出 |
| Notifier | `feishu` | 飞书机器人 |
| Notifier | `email` | 邮件 |
| Notifier | `wechat` | 微信（V2）|

## Booking Adapter

BookingProvider 是 §13.4 补充的接口——转化引擎在 lead 进入 `已加微` 之后，
需要监听外部预约来源（飞书日历 / 落地页 WebHook / 手动录入），把预约事件
回流到主流程，触发状态机推进（`已加微` → `已预约` → `已成交`）。

### 接口签名

```typescript
// src/adapters/booking/base.ts
interface BookingProvider {
  /** 启动监听，返回异步事件迭代器。调用方负责销毁迭代器以停止监听。 */
  watchBookings(): AsyncIterable<BookingEvent>;
  /** 健康检查 */
  ping(): Promise<boolean>;
}

interface BookingEvent {
  cid: string;                                     // 关联 lead 的 cid
  type: 'booked' | 'cancelled' | 'reminded';
  scheduledAt?: string;                            // ISO 8601
  channel: string;                                 // 'feishu_calendar' | 'webhook' | ...
  occurredAt: string;                              // ISO 8601
  metadata?: Record<string, unknown>;
}
```

### 已实现：`feishu_calendar`

`src/adapters/booking/feishu-calendar.ts` —— 轮询飞书日历 API（默认 60s/次），
从事件标题中按 `探星-{cid}-{日期}` 格式解析 cid，映射为 `BookingEvent`。

**依赖环境变量：**

| 变量 | 必填 | 说明 |
|---|---|---|
| `FEISHU_APP_ID` | ✅ | 与飞书 CRM 共用 |
| `FEISHU_APP_SECRET` | ✅ | 与飞书 CRM 共用 |
| `FEISHU_CALENDAR_ID` | ✅ | 监听的目标日历 ID |

**配置示例（conversion.yaml）：**

```yaml
booking_provider:
  type: feishu_calendar
  config:
    calendar_id_env: FEISHU_CALENDAR_ID
    webhook_secret_env: FEISHU_WEBHOOK_SECRET   # 可选
```

> **注册行为**：仅当 `FEISHU_APP_ID` + `FEISHU_APP_SECRET` + `FEISHU_CALENDAR_ID`
> 三个环境变量都存在时，`registerAll()` 才会注册此 provider；否则静默跳过。

### 已实现：`webhook`

`src/adapters/booking/webhook.ts` —— 通用 WebHook 接收器，内存队列 + 异步迭代器。
业务方在飞书/日历/落地页配置 WebHook URL 指向本服务的 `POST /webhook/booking` 端点，
事件入队后由 `watchBookings()` 持续 yield。

**依赖环境变量：**

| 变量 | 必填 | 说明 |
|---|---|---|
| `BOOKING_WEBHOOK_SECRET` | ❌ | 可选，用于 HMAC-SHA256 签名验证 |

`webhook.ts` 同时导出 `verifyWebhookSignature(body, signature, secret)` 工具函数
（生产环境用 `crypto.createHmac('sha256', secret).update(body).digest('hex')`）。

**调用方式：**

```typescript
const provider = new WebhookBooking({ queuePath: './data/booking-queue.jsonl' });
// 由 HTTP server 在 POST /webhook/booking 时调用：
provider.enqueue({ cid, type: 'booked', channel: 'webhook', occurredAt: new Date().toISOString() });
```

## Embedding Adapter

V1.4 把 Embedding 从 LLM 抽象中拆出，**不复用 LLMProvider**，原因是 embeddings
的 input（`{ input: string[] }`）和 response（`{ data: [{ embedding: number[] }] }`）
形状与 chat completion 完全不同。

### 接口签名

```typescript
// src/core/types.ts
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly model: string;
}
```

### 已实现：`openai`

`src/adapters/embeddings/openai.ts` —— 包装 OpenAI `/v1/embeddings` 端点。

**配置：**

| 字段 | 默认值 | 说明 |
|---|---|---|
| `apiKey` | — | 必填，OpenAI API Key |
| `baseUrl` | `https://api.openai.com/v1` | 自定义（用于代理/自部署）|
| `model` | `text-embedding-3-small` | 默认模型，1536 维 |

**依赖环境变量：**

| 变量 | 必填 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | 缺此变量时 `registerAll()` 不会注册此 provider |

**注册行为**：`src/adapters/embeddings/index.ts` 的 `registerAll()` 会在
`OPENAI_API_KEY` 存在时自动注册 `openai` provider，并打印注册日志：
`[adapters/embeddings] 已注册：openai`。

> **V2 计划**：DeepSeek / 本地 bge / ollama embeddings。

## 测试 Adapter

```typescript
import { registerBuiltins } from './adapters/registry.js';
import { getCRM } from './adapters/registry.js';

await registerBuiltins();
const crm = getCRM();
const ok = await crm.ping();
console.log('CRM ping:', ok);
```