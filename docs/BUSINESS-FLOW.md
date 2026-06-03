# 核心业务流程（7 步每日管道）

## 每日自动化管道 (runDaily)

### Step 1: 侦察 (Reconnaissance)
- 加载业务配置 (profile.yaml)
- 登录态检查 (channel.ping)
- 从抖音拉取评论（按 sec_uid 或 keyword 模式）

### Step 2: 分析 (Analysis)
- 预处理（去重、过滤营销号）
- LLM 意图分析（识别高意向客户）
- RAG 钩子生成（基于知识库生成个性化话术）

### Step 3: 同步 (Sync)
- 写入 CRM（CSV/飞书/Notion/Airtable）

### Step 4: 任务生成 (Task Generation)
- 状态机推进（新发现→已关注→已互动→...）
- 智能放弃判定（沉默/流失）
- 按 persona 价值排序，生成每日任务

### Step 5: 执行 (Execution)
- 浏览器自动化（点赞/评论/关注/私信）
- 限速 + 人类节奏延迟
- 转化引擎（加微后推送物料）

### Step 6: 通知 (Notification)
- 飞书/控制台 告警（登录失效/运行失败/成功）

### Step 7: 健康检查 (Health Check)
- 系统统计 + ROI 计算

---

## 三、核心实体

### 1. Lead（潜在客户）

```typescript
{
  cid: string;                    // 抖音评论 ID（唯一标识）
  nickname: string;               // 用户昵称
  comment_text: string;           // 评论内容
  intent_score: number;           // LLM 评估的意向分数 (0-1)
  persona: string;                // 客户画像（如 self_media, ecommerce）
  pain_point: string;             // 痛点描述
  buying_stage: string;           // 购买阶段（awareness/consideration/decision）
  status: LeadStatus;             // 状态机当前状态
}
```

### 2. Task（引导任务）

```typescript
{
  task_id: string;
  lead_cid: string;               // 关联的 Lead
  next_action: TaskAction;        // like_and_follow | comment_reply | friend_request | dm
  hook: string;                   // 话术内容
  hook_style: string;             // 钩子风格（朋友推荐/顾问等）
  scheduled_at: string;           // 计划执行时间
}
```

---

## 四、状态机（Lead 生命周期）

```
新发现 → 已关注 → 已互动 → 已加好友 → 已加微 → 已预约 → 已成交
                                      ↘ 已流失（3次无回应/被拒）
                                      ↘ 沉默（30天无互动）
                                      ↘ 已再激活（沉默后重新触达）
```

---

## 五、4 个自动回路（反馈驱动优化）

| 回路 | 机制 | 作用 |
|------|------|------|
| 回路 1 | 关键词权重归因 | 高转化关键词权重↑，低转化↓ |
| 回路 2 | 钩子风格 A/B 测试 | 自动选择效果最好的话术风格 |
| 回路 3 | Persona 价值排序 | 高价值客户类型优先处理 |
| 回路 4 | 最佳互动时段 | 按 persona 选择最佳推送时间 |

---

## 六、浏览器自动化（5 种动作）

| 动作 | 实现方式 |
|------|----------|
| `like_and_follow` | 点赞 + 关注作者 |
| `comment_reply` | 评论回复（逐字输入模拟人类） |
| `friend_request` | 关注用户 |
| `dm` | 发送私信 |
| `send_material` | 发送物料（PDF/链接） |

**安全机制：**
- 限速（每日关注/私信上限）
- 人类节奏随机延迟
- 风控检测（验证码/封号）
- 紧急停止开关

---

## 七、配置驱动

项目通过 YAML 文件配置业务：

| 文件 | 作用 |
|------|------|
| `profile.yaml` | 业务画像、LLM 配置、目标人群 |
| `channels.yaml` | 抖音数据源配置（关键词/sec_uid） |
| `conversion.yaml` | 转化路径、物料配置 |
| `crm.yaml` | CRM 适配器配置 |
| `schedule.yaml` | 定时任务配置 |

---

## 八、数据流

```
抖音评论 → LLM 分析 → Lead (CRM) → 状态机 → Task → 浏览器执行 → 事件记录 → 反馈分析 → 优化权重
   ↑                                                                                              ↓
   └──────────────────────────────────── 关键词权重调整 ←─────────────────────────────────────────┘
```

---

> 📌 **核对备注**（按 `run-daily.ts` / `types.ts` / `state-machine.ts` 实际代码核对后）：
> - 状态机 `已加好友` 和 `已加微` 之间还隔着 `已私信`（`dm` 动作推到 `已私信`，`send_material` 才推到 `已加微`），原描述缺这一环。
> - `schedule.yaml` 已被删除（`git status` 显示 `D schedule.yaml`），当前根目录实际只有 4 个 YAML。
> - `Task.next_action` 实际有 5 种动作（含 `send_material`），原描述只列了 4 种。
> - 实际还有第 5 个反馈回路（`LeadEvent.touchpoint_*`，触达方式归因），原描述只列了 4 个。
>
> 以上 4 处是否要并入正文，由你决定。
