# 反馈分析器算法 Spec（v1.4）

> 用途：让探星从「固定剧本」变成「自适应系统」。本文档定义 §3.11 反馈分析器的**所有数值公式**与**决策边界**——代码实现必须严格按此 spec。
>
> 适用范围：`src/modules/feedback-analyzer/index.ts`

---

## 1. 学习期（Learning Period）

### 1.1 规则

**反馈分析器在以下条件**全部满足**前不出调整建议**：

| 条件 | 默认值 | 原因 |
|---|---|---|
| 启动后累计天数 | ≥ 14 天 | 2 周数据才能跨「工作日/周末」波动 |
| lead 总数 | ≥ 30 条 | 低于此样本量统计意义弱 |
| 任何 persona 的样本数 | ≥ 5 条 | 避免小样本误判 |

### 1.2 实现位置

```typescript
// src/modules/feedback-analyzer/index.ts
function isLearningPeriodComplete(stats: SystemStats): boolean {
  return stats.daysSinceStart >= 14
    && stats.totalLeads >= 30
    && Object.values(stats.leadsByPersona).every(n => n >= 5);
}
```

### 1.3 行为

- **未满足**任何条件：周报推送「📊 探星运行 X 天 | Y lead | 学习中，暂无建议」
- **满足**：周报推送完整优化建议（见 §5）

---

## 2. 关键词权重调整（Keyword Weight Tuning）

### 2.1 输入

```typescript
interface KeywordEvent {
  keyword: string;             // 触发该 lead 的关键词
  cid: string;                 // lead 唯一 ID
  finalStatus: LeadStatus;     // 该 lead 的最终状态（已成交 / 已流失 / 其他）
  daysToConvert: number;       // 从新发现到 finalStatus 的天数
  timestamp: string;           // ISO 8601
}
```

### 2.2 转化判定

```typescript
// 把任意状态映射为二值「是否算转化成功」
function isConverted(status: LeadStatus, business: BusinessProfile): boolean {
  // 业务方在 conversion.yaml.lifecycle_states 里标记的"成功态"
  return business.conversion.success_states.includes(status);
  // 默认：['已成交']
}
```

### 2.3 核心公式：贝叶斯平滑

**为什么不用原始转化率**：`"AI 客服 电商" 1/1 = 100%` 不可信。需要先验平滑。

```
调整后转化率 = (成功数 + α × 全局基准率) / (样本数 + α)

其中：
  α = 10（先验强度，V1.4 硬编码）
  全局基准率 = 全部关键词的成功总数 / 全部关键词的样本总数
```

**示例**：
- 关键词 A：50 leads，5 成功 → 原始率 10%
- 关键词 B：1 lead，1 成功 → 原始率 100%
- 全局：200 leads，20 成功 → 基准率 10%
- A 平滑后：(5 + 10×0.1) / (50 + 10) = 6/60 = **10.0%**
- B 平滑后：(1 + 10×0.1) / (1 + 10) = 2/11 = **18.2%** ← 还是偏高但不至于 100%

### 2.4 权重调整公式

```typescript
// 输入：当前权重 + 平滑后转化率
// 输出：建议新权重
const MIN_WEIGHT = 0.1;  // V1.4 硬编码
const MAX_WEIGHT = 2.0;
const NEUTRAL_WEIGHT = 1.0;

function newWeight(
  currentWeight: number,
  smoothedRate: number,
  globalRate: number
): number {
  const ratio = smoothedRate / Math.max(globalRate, 0.001);

  // 比例 → 权重（用对数缩放，避免极端）
  // ratio = 2.0 → weight = 1.41 (× √2)
  // ratio = 0.5 → weight = 0.71 (× 1/√2)
  // ratio = 1.0 → weight = 1.00 (no change)
  const proposed = currentWeight * Math.sqrt(ratio);

  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, proposed));
}
```

### 2.5 自动应用 vs 手动确认

| 条件 | 行为 |
|---|---|
| `|newWeight - currentWeight| / currentWeight < 0.20`（变化 < 20%）| **自动应用** + 周报标记「✅ 已应用」 |
| 变化 ≥ 20% | **手动确认** + 周报标记「⚠️ 需确认」+ 推送时附 `apply` 按钮 |
| 关键词当前样本 < 5 | **不动**（不参与本轮调整）|
| 关键词已被手动禁用（`channels.yaml` 里 `disabled: true`）| **不动** |

---

## 3. 钩子风格 A/B 测试

### 3.1 分桶规则

```typescript
// 业务方在 hook_config.styles 数组里定义可选风格
// V1.4 默认：["朋友推荐", "顾问", "案例引用"]

function assignHookStyle(
  cid: string,
  styles: string[]
): string {
  // 用 cid 的哈希取模做稳定分桶（同 lead 永远用同风格 → 避免 A/B 污染）
  const hash = sha1(cid).slice(0, 8);
  const bucket = parseInt(hash, 16) % styles.length;
  return styles[bucket];
}
```

**为什么不随机**：随机会让同一 lead 在不同任务里被分到不同风格，**回复率数据被自己的波动污染**。

### 3.2 评估指标

| 指标 | 计算 | 用作 |
|---|---|---|
| **回复率** | 风格 S 的「有回应」lead 数 / 风格 S 的总 lead 数 | 主指标 |
| **加微率** | 风格 S 的「已加微」lead 数 / 风格 S 的总 lead 数 | 次要（看深度） |
| **样本量** | 风格 S 的总 lead 数 | **门槛**（< 20 不出建议） |

### 3.3 风格调整规则

```typescript
const MIN_SAMPLES_PER_STYLE = 20;
const SIGNIFICANT_DIFF = 0.05;  // 5% 绝对差才认为有差异

function pickBestStyle(stats: Record<string, StyleStats>): string {
  const valid = Object.entries(stats)
    .filter(([_, s]) => s.total >= MIN_SAMPLES_PER_STYLE);

  if (valid.length < 2) return '朋友推荐'; // fallback

  const sorted = valid.sort((a, b) => b[1].replyRate - a[1].replyRate);
  const [best, bestStats] = sorted[0];
  const [, secondStats] = sorted[1];

  if (bestStats.replyRate - secondStats.replyRate < SIGNIFICANT_DIFF) {
    return '朋友推荐'; // 差异不显著，保留默认
  }
  return best;
}
```

### 3.4 自动应用 vs 手动确认

- **风格切换** = 业务表达/品牌声音变化 → **永远手动确认** + 周报标记「⚠️ 风格 X 表现优于 Y，建议切换」

---

## 4. Persona 价值排序

### 4.1 计算

```typescript
interface PersonaValue {
  persona: string;
  leads: number;
  conversions: number;
  revenue: number;          // 来自 CRM 字段
  valueScore: number;       // 0-10
}

function computePersonaValue(
  business: BusinessProfile,
  persona: string,
  stats: PersonaStats
): number {
  // 价值分 = 0.5 × 转化率分 + 0.3 × 营收分 + 0.2 × 样本量分
  const conversionScore = stats.conversionRate * 10;  // 0-10
  const revenueScore = Math.min(10, Math.log10(stats.avgRevenue + 1) * 2);
  const sampleScore = Math.min(10, Math.log10(stats.leads + 1) * 3);

  return round1(
    0.5 * conversionScore
    + 0.3 * revenueScore
    + 0.2 * sampleScore
  );
}
```

### 4.2 反馈写入

- `value_score` 写回 `business/profile.yaml` 对应 persona（**手动确认后**）
- 引导引擎 (§3.6) 读取 `value_score` 排序，高价值 persona 优先分配任务

### 4.3 自动应用 vs 手动确认

- **Persona 价值分变化** = 业务方向调整 → **永远手动确认** + 周报标记「💎 persona X 价值上升 / 💤 persona Y 价值下降」

---

## 5. 最佳互动时段

### 5.1 计算

按 persona × 时段（小时桶，0-23）统计「lead 创建时间 → 任务执行时间」分布：

```typescript
interface HourlyStats {
  hour: number;            // 0-23
  totalLeads: number;
  responses: number;       // 有回应的 lead 数
  responseRate: number;    // 0-1
}

function bestHoursForPersona(
  persona: string,
  events: LeadEvent[]
): number[] {
  // 1. 按 persona 过滤
  // 2. 按小时桶聚合
  // 3. 过滤样本 < 3 的桶
  // 4. 按 responseRate 降序，取 top 3
  // ...
}
```

### 5.2 自动应用 vs 手动确认

- **时段推荐** = 业务节奏调整 → **永远手动确认** + 周报标记「⏰ 建议私信时段：周二/周五 14-16 点」

---

## 6. 周报推送格式

每周一 09:00 推送的「探星优化建议」模板（与 §3.11 同步）：

```
📊 探星优化建议（第 X 周）

[学习期检查]
总 lead: 87（≥30 ✅）| 启动天数: 21（≥14 ✅）| 全部 persona ≥5: ✅
（学习期未完成时，整段替换为「仍在学习中」）

[关键词调整]
✅ 提升 "AI 客服 电商" 权重 1.0 → 1.4（+40%，自动应用）
   依据：50 leads，5 成功，平滑转化率 10.0%（全局 9.5%）
⚠️ 降低 "AI 剪辑 自媒体" 权重 1.0 → 0.6（-40%，需手动确认）
   依据：30 leads，1 成功，平滑转化率 6.4%（低于全局）
   [应用此调整]  [忽略]

[钩子风格]
⚠️ "朋友推荐" 回复率 25%（n=100）显著优于 "顾问" 18%（n=100），差 7%
   建议默认切换为 "朋友推荐"
   [应用切换]  [忽略]

[Persona 价值]
💎 "self_media" 价值分 8.5（上升 +0.3）
💤 "ecommerce" 价值分 4.2（下降 -0.8）
   建议下月重点投入 self_media
   [更新 profile.yaml]  [忽略]

[时段]
⏰ 最佳私信时段：周二/周五 14-16 点（n=12, 回复率 33%）
   [更新 channels.yaml]  [忽略]

[已自动应用] 关键词权重 "AI 客服 电商" 1.0 → 1.4
[需手动确认] 4 项（见上）
```

---

## 7. 单元测试要点

`src/modules/feedback-analyzer/__tests__/index.test.ts` 必须覆盖：

1. **学习期判定**：3 个条件任意一个不满足 → 返回「学习中」+ 不计算任何指标
2. **贝叶斯平滑**：边界用例（n=0、n=1、n=10000）+ 与手算对照
3. **权重钳位**：任何输入 → 输出在 [0.1, 2.0]
4. **A/B 分桶稳定性**：同一 cid 调用 100 次 → 100% 同 bucket
5. **风格切换门槛**：差异 < 5% → 不切换
6. **Persona 价值分**：手算对照（已知数据 → 已知分）
7. **时段聚合**：跨日 / 跨时区处理

---

## 8. 边界与失败模式

| 场景 | 行为 |
|---|---|
| `events.jsonl` 文件损坏 / 缺字段 | 跳过该条事件 + 日志告警 + 继续 |
| `business/profile.yaml` 缺 `success_states` 字段 | 用默认值 `['已成交']` + 日志告警 |
| `channels.yaml` 关键词全被禁用 | 周报「无可调整关键词」 |
| 全 persona 样本都 < 5 | 强制延长学习期 + 周报「样本不足」 |
| `value_score` 写入 profile.yaml 失败 | 回滚 + 推送「写入失败，请检查文件权限」 |

---

## 9. 配置开关

业务方可在 `business/profile.yaml` 关闭某个维度的自动应用：

```yaml
feedback_config:
  auto_apply:
    keyword_weight: true       # 默认 true
    hook_style: false          # 默认 false（声音变化风险大）
    persona_value: false       # 默认 false
    interaction_time: false    # 默认 false
```

**所有 `auto_apply` 默认保守——只有关键词权重是 true**，其他三个需要业务方主动 opt-in。
