/**
 * 探星（Explore-Star）核心类型定义
 *
 * 这是所有跨模块数据结构的**单一真相源**。所有 Adapter 实现、模块
 * 输入输出都必须用这里的类型（不允许在模块内重新定义 Lead / Profile 等）。
 *
 * 对应文档：
 *   - §3.3 Lead 字段
 *   - §3.5 CRM 标准字段映射
 *   - §3.6.1 Task / TaskResult
 *   - §2.4 business/*.yaml schema
 *   - §13.4 Adapter 接口
 *
 * 设计原则：
 *   1. 业务无关：所有字段对任意业务通用
 *   2. 严格 null/undefined 区分
 *   3. 时间字段统一 ISO 8601 字符串（不混用 Date 对象，方便 JSON 序列化）
 *   4. 任何「业务方自定义」字段用 Record<string, unknown> 兜底
 */

// ============================================================================
// 1. 业务画像（BusinessProfile）—— business/profile.yaml
// ============================================================================

export interface BusinessProfile {
  business: {
    name: string;            // 业务名（用于 LLM prompt、通知、CRM 标识）
    value_prop: string;      // 一句话价值主张
    description?: string;
  };

  target_personas: Persona[];

  intent_signals: string[];  // 意图信号词（供 §3.3 prompt 用）
  buying_stages?: BuyingStage[];  // 可选；不填则用默认三段式

  llm: LLMConfig;
  crm: CRMConfig;

  hook_config?: {
    style?: string;          // 默认「朋友推荐，不像销售」
    max_length?: number;     // 默认 30
    language?: string;       // 默认「中文」
    styles?: string[];       // A/B 测试用风格池（默认 ["朋友推荐", "顾问"]）
  };

  feedback_config?: {
    auto_apply?: {
      keyword_weight?: boolean;     // 默认 true
      hook_style?: boolean;         // 默认 false
      persona_value?: boolean;      // 默认 false
      interaction_time?: boolean;   // 默认 false
    };
  };

  observability?: {
    run_history?: { enabled?: boolean };          // 默认 true
    notifier?: {
      enabled?: boolean;                          // 默认 true
      channels?: string[];                        // 默认 ['console']
    };
  };

  prompts_dir?: string;      // 默认 business/prompts/
  knowledge_dir?: string;    // 默认 business/knowledge/
}

export interface Persona {
  id: string;                // 如 self_media, ecommerce
  name: string;              // 显示名
  description?: string;
  typical_pain_points: string[];  // 典型痛点（intent prompt 用）
  value_score?: number;      // 0-10，§3.11 自动调整（默认 5.0）
}

export interface BuyingStage {
  id: string;                // awareness / consideration / decision
  name: string;
  description: string;       // 给 LLM 的判断标准
}

export interface LLMConfig {
  provider: 'openai' | 'deepseek' | 'anthropic' | 'ollama' | 'custom';
  model: string;             // 如 deepseek-v3, gpt-4o-mini
  api_key_env: string;       // 环境变量名
  base_url?: string;         // 自定义 base URL（用于代理/自部署）
  temperature?: number;      // 默认 0.3
  max_tokens?: number;       // 默认 1000
  fallback?: Array<{         // 降级链
    provider: LLMConfig['provider'];
    model: string;
  }>;
}

export interface CRMConfig {
  type: 'feishu' | 'notion' | 'airtable' | 'csv' | 'custom';
  config: Record<string, unknown>;  // 字段因 type 而异
  field_mapping?: Record<string, string>;  // 标准 Lead 字段 → CRM 字段
}

// ============================================================================
// 2. 渠道配置（ChannelsConfig）—— business/channels.yaml
// ============================================================================

export interface ChannelsConfig {
  source?: {
    mode: 'sec_uid' | 'keyword' | 'both';  // 默认 sec_uid
  };
  search?: {
    keywords: Record<string, { weight: number }>;  // keyword → weight
    limit_per_keyword?: number;     // 默认 10，硬上限 30
  };
  target_sec_uids?: {
    sec_uids: string[];             // KOL sec_uid 列表
    user_videos_limit?: number;     // 默认 20，硬上限 20
    comment_limit?: number;         // 默认 10，硬上限 10
  };
  filters?: {
    min_likes?: number;             // 默认 100
    max_age_days?: number;          // 默认 30
  };
  comment_filters?: {
    min_length?: number;            // 默认 4
    exclude_emoji_only?: boolean;   // 默认 true
    exclude_punctuation_only?: boolean; // 默认 true
    exclude_marketing?: boolean;    // 默认 true（由 LLM 判断）
  };
  /**
   * Phase 1 #2: 渠道速率限制（QPS + daily quota）。
   * 0 = 停服（fail-loud 触发 notifier critical）。
   * 不存在时：调度器使用 ChannelAdapter.rateLimits 默认值。
   */
  channel_rate_limits?: {
    douyin?: {
      search_qps: number;
      user_videos_qps: number;
      comment_qps: number;
      friend_request_per_day: number;
      dm_per_day: number;
    };
  };
}

// ============================================================================
// 3. 转化配置（ConversionConfig）—— business/conversion.yaml
// ============================================================================

export interface ConversionConfig {
  lifecycle_states: LifecycleState[];  // 业务自定义生命周期
  success_states: string[];            // 算"转化成功"的状态 ID（默认 ['closed']）
  post_add_asset?: {
    type: 'pdf' | 'link' | 'image';
    name: string;
    path: string;              // 本地路径或 URL
  };
  booking_url?: string;        // 转化路径入口
  message_template?: string;   // 加微后推送话术
  booking_provider?: {
    type: 'feishu_calendar' | 'webhook' | 'manual';
    config: Record<string, unknown>;
  };
  reactivation?: {
    dormant_days?: number;     // 默认 30
    max_attempts?: number;     // 默认 1
    message_template?: string;
  };
  /** 业务方定义的额外字段（cost_per_lead / revenue_field 等） */
  cost_per_lead?: number;      // 单 lead 成本估算
  revenue_field?: string;      // CRM 中"营收"字段名
}

export interface LifecycleState {
  id: string;                  // 如 wechat_added / booked / closed
  name: string;                // 显示名
  is_terminal: boolean;        // 已成交/已流失 = true
}

// ============================================================================
// 4. Lead —— 核心实体
// ============================================================================

export type LeadStatus =
  | '新发现'
  | '已关注'
  | '已互动'
  | '已加好友'
  | '已私信'
  | '已加微'
  | '已预约'
  | '已成交'
  | '已流失'
  | '沉默'
  | '已再激活'
  | (string & {});  // 支持 conversion.yaml 中业务方自定义状态（如 '已诊断' '已试用'）

export interface Lead {
  // 身份
  cid: string;                          // 抖音评论 ID（唯一）
  source: 'douyin_search' | 'douyin_user_videos' | 'manual';
  aweme_id: string;                     // 关联视频 ID
  video_url: string;                    // 视频链接
  video_desc: string;                   // 视频标题/描述（给 LLM 上下文）
  keyword: string;                      // 触发该 lead 的关键词/sec_uid

  // 用户信息
  nickname: string;
  user_signature: string;               // 抖音个人签名
  follower_count: number;
  user_uid: string;

  // 评论内容
  comment_text: string;
  comment_digg_count: number;
  comment_create_time: string;          // ISO 8601

  // LLM 分析结果（§3.3）
  is_target_persona: boolean;
  persona: string;                      // target_personas.id 之一
  pain_point: string;                   // 10-20 字
  intent_score: number;                 // 0-1
  buying_stage: string;                 // buying_stages.id
  suggested_reply_hook: string;
  suggested_dm_hook: string;

  // 状态机（§3.6）
  status: LeadStatus;
  status_history: Array<{
    from: LeadStatus | null;
    to: LeadStatus;
    at: string;                         // ISO 8601
    note?: string;
  }>;

  // 用户拒绝标记（§3.6.3 opt_out 检测）
  /** 用户明确拒绝（私信中说"不需要"/"别发了"等），立即停止所有后续任务 */
  opt_out?: boolean;

  // 互动效果感知（§3.6.2）
  last_task_executed_at?: string;
  last_task_result?: '有回应' | '无回应' | '被拒' | '未执行';
  last_response_text?: string;
  execution_count: number;
  response_count: number;

  // 转化（§3.10）
  wechat_added_at?: string;
  booked_at?: string;
  closed_at?: string;
  revenue?: number;                     // CRM 中的营收字段
  last_interaction_at?: string;

  // 元数据
  created_at: string;
  updated_at: string;
  notes?: string;
  custom_fields?: Record<string, unknown>;

  // 🆕 反馈分析归因字段（§3.11 全链路归因）
  /** 触发该 lead 的关键词/sec_uid（回路 1 关键词权重归因） */
  source_keyword?: string;
  /** 来源视频 ID（与 aweme_id 一致；显式声明以满足 §3.11 字段契约） */
  source_video_id?: string;
  /** 实际使用的钩子风格（回路 2 钩子风格 A/B 归因） */
  hook_style?: string;
  /** lead 首次发现时间 ISO 8601（与 created_at 通常相同；显式声明满足 §3.3 字段契约） */
  detected_at?: string;
}

// ============================================================================
// 5. Comment —— 原始评论（LLM 处理前）
// ============================================================================

export interface Comment {
  cid: string;
  aweme_id: string;
  video_url: string;
  video_desc: string;
  keyword: string;                      // 触发来源

  text: string;
  user: {
    nickname: string;
    uid: string;
    follower_count: number;
    signature: string;
  };
  digg_count: number;
  create_time: string;                  // ISO 8601
  reply_count: number;
}

// ============================================================================
// 6. Task —— 引导任务（§3.6.1）
// ============================================================================

export type TaskAction =
  | 'like_and_follow'
  | 'comment_reply'
  | 'friend_request'
  | 'dm'
  | 'send_material';

export type TaskResult =
  | 'executed_with_response'
  | 'executed_no_response'
  | 'rejected'
  | 'failed_risk'
  | 'failed_network'
  | 'skipped';

export interface Task {
  task_id: string;                      // UUID
  lead_cid: string;
  nickname: string;
  current_state: LeadStatus;
  next_action: TaskAction;
  hook: string;
  hook_style: string;                   // 本次使用的钩子风格
  priority: 'high' | 'medium' | 'low';
  persona: string;
  scheduled_at: string;                 // ISO 8601
  reason: string;                       // 调度理由
  executed_at?: string;
  execution_result?: TaskResult;
  risk_signal?: string;
  // 浏览器执行所需（§3.6.5 browserExecute 依赖）
  video_url?: string;                   // 视频链接（like_and_follow / comment_reply 需要）
  user_sec_uid?: string;                // 用户 sec_uid（friend_request / dm 需要）
  // §3.11 关键词归因（从 lead.source_keyword 透传）
  source_keyword?: string;
}

// ============================================================================
// 7. Conversion —— 转化引擎（§3.10）
// ============================================================================

export interface ConversionAction {
  type: 'send_pdf' | 'send_booking_link' | 'send_followup';
  channel: 'wechat' | 'feishu' | 'email';
  payload: Record<string, unknown>;
  scheduled_at: string;                 // ISO 8601
}

export interface ConversionReport {
  date: string;                         // YYYY-MM-DD
  new_leads: number;
  new_wechat_added: number;
  new_bookings: number;
  new_deals_closed: number;
  revenue_today: number;
  weekly_revenue: number;
  cost_today: number;
  roi_today: number;
  hot_leads: Lead[];
  at_risk_leads: Lead[];
}

// ============================================================================
// 8. Feedback —— 反馈分析器（§3.11）
// ============================================================================

export interface LeadEvent {
  event: 'lead_status_changed' | 'lead_created' | 'task_executed' | 'touchpoint_sent' | 'touchpoint_replied';
  cid: string;
  from_status?: LeadStatus;
  to_status?: LeadStatus;
  keyword: string;
  hook_style: string;
  hook_text: string;
  persona: string;
  interaction_time: string;             // ISO 8601
  days_to_convert?: number;
  metadata?: Record<string, unknown>;
  // Touchpoint-specific fields (F12: §3.10 触达方式归因回路)
  touchpoint_type?: string;             // 触达类型，如 send_pdf / send_booking_link / send_followup / reactivate
  touchpoint_channel?: string;          // 触达渠道，如 wechat / sms / console
  touchpoint_result?: 'opened' | 'replied' | 'booked' | 'no_response';
}

export interface KeywordPerformance {
  keyword: string;
  leads: number;
  conversions: number;
  rate: number;                         // 原始转化率
  smoothed_rate: number;                // 贝叶斯平滑后
  weight: number;                       // 当前权重
  suggested_weight?: number;            // 建议权重
  auto_apply: boolean;                  // 是否自动应用
}

export interface HookStylePerformance {
  style: string;
  tested: number;
  replied: number;
  rate: number;
}

export interface PersonaValue {
  persona: string;
  leads: number;
  conversions: number;
  revenue: number;
  value_score: number;                  // 0-10
}

export interface BestInteractionTimes {
  persona: string;
  hours: Array<{
    weekday: number;                    // 0-6 (周日=0)
    hour: number;                       // 0-23
    rate: number;
    sample: number;
  }>;
}

export interface WeeklyInsights {
  week_start: string;                   // YYYY-MM-DD
  learning_period_complete: boolean;
  keyword_performance: KeywordPerformance[];
  hook_style_performance: HookStylePerformance[];
  persona_value: PersonaValue[];
  best_interaction_times: BestInteractionTimes[];
  generated_at: string;
}

// ============================================================================
// 9. Adapter 接口（§13.4）—— 完整版
// ============================================================================

// LLM Provider
export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
  stop?: string[];
}

export interface LLMProvider {
  complete(prompt: string, opts?: LLMOptions): Promise<string>;
  embed(text: string): Promise<number[]>;
  readonly capabilities: {
    jsonMode: boolean;
    functionCalling: boolean;
    vision: boolean;
    contextWindow: number;
  };
  readonly pricing: {
    inputPerMTok: number;
    outputPerMTok: number;
    embedPerMTok: number;
  };
  ping(): Promise<{ ok: boolean; latency_ms: number }>;
}

// CRM
export interface SyncResult {
  synced: number;
  failed: number;
  errors: Array<{ cid: string; error: string }>;
}

export interface LeadFilter {
  status?: LeadStatus[];
  persona?: string[];
  intent_score_gte?: number;
  created_after?: string;
  created_before?: string;
  has_open_task?: boolean;
}

export interface CRMAdapter {
  syncLeads(leads: Lead[]): Promise<SyncResult>;
  getLead(cid: string): Promise<Lead | null>;
  updateStatus(cid: string, status: LeadStatus, note?: string): Promise<void>;
  /** 更新指定 lead 的若干字段（如 hook_style）。失败抛错。 */
  updateLeadFields(cid: string, fields: Partial<Lead>): Promise<void>;
  listLeads(filter?: LeadFilter): Promise<Lead[]>;
  ping(): Promise<boolean>;
}

// Channel
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
  rank: number;
  desc: string;
  author: string;
  url: string;
  plays: number;
  likes: number;
  comments: number;
  shares: number;
  aweme_id?: string;                    // 从 url 提取
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

export interface UserVideo {
  index: number;
  aweme_id: string;
  title: string;
  duration: number;
  digg_count: number;
  play_url: string;
  top_comments: Array<{
    cid: string;
    text: string;
    user: {
      nickname: string;
      uid: string;
      follower_count: number;
      signature: string;
    };
    digg_count: number;
    create_time: number;
    reply_count: number;
  }>;
}

export interface RateLimits {
  search_per_hour: number;
  user_videos_per_hour: number;
  comment_per_hour: number;
  friend_request_per_day: number;
  dm_per_day: number;
}

// ============================================================================
// Phase 3 #5 多渠道架构准备（roadmap §2.5）—— channel 速率策略 schema
// ============================================================================

/**
 * Channel 自我声明的 QPS 上限（**业务方策略**，写在 channels.yaml 的 `channels.<name>.qps` 节点）。
 *
 * 与 `RateLimits` 的区别：
 *   - `RateLimits`：平台硬上限（puppeteer / API 客观限制，写死在 channel adapter 里）
 *   - `QpsLimit`：探星系统对自身的限速（业务方可调，写在 yaml 里）
 *
 * 给 #2 rate-limiter 调度器消费。
 */
export interface ChannelQpsLimit {
  /** 单一动作的最大 QPS（如 1 = 1 req/sec） */
  qps?: number;
  /** 突发容量（默认 = qps） */
  burst?: number;
}

/**
 * Channel 自我声明的每日配额。
 *
 * `null` = 平台不限。
 * `by_action` 可覆盖 `total`（更细粒度）。
 */
export interface ChannelDailyQuota {
  /** 平台每天允许的总动作数；null = 平台不限 */
  total?: number | null;
  /** 动作级配额（可选，覆盖 total） */
  by_action?: Partial<{
    search: number;
    user_videos: number;
    comments: number;
  }>;
}

export interface ChannelAdapter {
  readonly name: string;
  readonly rateLimits: RateLimits;
  search(query: SearchQuery): Promise<Video[]>;
  getUserVideos(secUid: string, opts?: { limit?: number; withComments?: boolean; commentLimit?: number }): Promise<UserVideo[]>;
  ping(): Promise<{ ok: boolean; loggedIn: boolean }>;
}

// Notifier
export interface NotificationMessage {
  title?: string;
  body: string;                         // 支持 markdown
  level?: 'info' | 'warning' | 'critical';
  actions?: Array<{ label: string; url: string }>;
}

export interface SendResult {
  ok: boolean;
  message_id?: string;
  error?: string;
}

export interface Notifier {
  readonly name: string;
  send(message: NotificationMessage): Promise<SendResult>;
}

// Embeddings
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly model: string;
}

// ============================================================================
// 10. 系统统计（反馈分析器 + 健康检查用）
// ============================================================================

export interface SystemStats {
  daysSinceStart: number;
  totalLeads: number;
  leadsByPersona: Record<string, number>;
  leadsByStatus: Record<LeadStatus, number>;
  conversionRate: number;               // 全部 lead 的转化率
  costThisMonth: number;                // LLM + 通知 API 成本
  revenueThisMonth: number;             // CRM 聚合
  lastRunAt: string;
  lastRunStatus: 'success' | 'failed' | 'partial';
}
