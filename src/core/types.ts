export interface BusinessProfile {
  business: {
    name: string;
    value_prop: string;
    description?: string;
  };

  target_personas: Persona[];

  intent_signals: string[];
  buying_stages?: BuyingStage[];

  llm: LLMConfig;
  crm: CRMConfig;

  channel?: {
    name: string;
  };
  embedding?: {
    provider: string;
  };
  notifier?: {
    default?: string;
  };

  hook_config?: {
    style?: string;
    max_length?: number;
    language?: string;
    styles?: string[];
  };

  feedback_config?: {
    auto_apply?: {
      keyword_weight?: boolean;
      hook_style?: boolean;
      persona_value?: boolean;
      interaction_time?: boolean;
    };
  };

  observability?: {
    run_history?: { enabled?: boolean };
    notifier?: {
      enabled?: boolean;
      channels?: string[];
    };
  };

  prompts_dir?: string;
  knowledge_dir?: string;
}

export interface Persona {
  id: string;
  name: string;
  description?: string;
  typical_pain_points: string[];
  value_score?: number;
}

export interface BuyingStage {
  id: string;
  name: string;
  description: string;
}

export interface LLMConfig {
  provider: 'openai' | 'deepseek' | 'anthropic' | 'ollama' | 'custom';
  model: string;
  api_key_env: string;
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
  fallback?: Array<{
    provider: LLMConfig['provider'];
    model: string;
  }>;
}

export interface CRMConfig {
  type: 'feishu' | 'notion' | 'airtable' | 'csv' | 'custom';
  config: Record<string, unknown>;
  field_mapping?: Record<string, string>;
}

export interface ChannelsConfig {
  source?: {
    mode: 'sec_uid' | 'keyword' | 'both';
  };
  search?: {
    keywords: Record<string, { weight: number }>;
    limit_per_keyword?: number;
  };
  target_sec_uids?: {
    sec_uids: string[];
    user_videos_limit?: number;
    comment_limit?: number;
  };
  filters?: {
    min_likes?: number;
    max_age_days?: number;
  };
  comment_filters?: {
    min_length?: number;
    exclude_emoji_only?: boolean;
    exclude_punctuation_only?: boolean;
    exclude_marketing?: boolean;
  };
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

export interface ConversionConfig {
  lifecycle_states: LifecycleState[];
  success_states: string[];
  post_add_asset?: {
    type: 'pdf' | 'link' | 'image';
    name: string;
    path: string;
  };
  booking_url?: string;
  message_template?: string;
  booking_provider?: {
    type: 'feishu_calendar' | 'webhook' | 'manual';
    config: Record<string, unknown>;
  };
  reactivation?: {
    dormant_days?: number;
    max_attempts?: number;
    message_template?: string;
  };
  cost_per_lead?: number;
  revenue_field?: string;
}

export interface LifecycleState {
  id: string;
  name: string;
  is_terminal: boolean;
}

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
  | (string & {});

export interface Lead {
  cid: string;
  source: 'douyin_search' | 'douyin_user_videos' | 'manual';
  aweme_id: string;
  video_url: string;
  video_desc: string;
  keyword: string;

  nickname: string;
  user_signature: string;
  follower_count: number;
  user_uid: string;

  comment_text: string;
  comment_digg_count: number;
  comment_create_time: string;

  is_target_persona: boolean;
  persona: string;
  pain_point: string;
  intent_score: number;
  buying_stage: string;
  suggested_reply_hook: string;
  suggested_dm_hook: string;

  status: LeadStatus;
  status_history: Array<{
    from: LeadStatus | null;
    to: LeadStatus;
    at: string;
    note?: string;
  }>;

  opt_out?: boolean;

  last_task_executed_at?: string;
  last_task_result?: '有回应' | '无回应' | '被拒' | '未执行';
  last_response_text?: string;
  execution_count: number;
  response_count: number;

  wechat_added_at?: string;
  booked_at?: string;
  closed_at?: string;
  revenue?: number;
  last_interaction_at?: string;

  created_at: string;
  updated_at: string;
  notes?: string;
  custom_fields?: Record<string, unknown>;

  source_keyword?: string;
  source_video_id?: string;
  hook_style?: string;
  detected_at?: string;
}

export interface Comment {
  cid: string;
  aweme_id: string;
  video_url: string;
  video_desc: string;
  keyword: string;

  text: string;
  user: {
    nickname: string;
    uid: string;
    follower_count: number;
    signature: string;
  };
  digg_count: number;
  create_time: string;
  reply_count: number;
}

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
  task_id: string;
  lead_cid: string;
  nickname: string;
  current_state: LeadStatus;
  next_action: TaskAction;
  hook: string;
  hook_style: string;
  priority: 'high' | 'medium' | 'low';
  persona: string;
  scheduled_at: string;
  reason: string;
  executed_at?: string;
  execution_result?: TaskResult;
  risk_signal?: string;
  video_url?: string;
  user_sec_uid?: string;
  source_keyword?: string;
}

export interface ConversionAction {
  type: 'send_pdf' | 'send_booking_link' | 'send_followup';
  channel: 'wechat' | 'feishu' | 'email';
  payload: Record<string, unknown>;
  scheduled_at: string;
}

export interface ConversionReport {
  date: string;
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

export interface LeadEvent {
  event: 'lead_status_changed' | 'lead_created' | 'task_executed' | 'touchpoint_sent' | 'touchpoint_replied';
  cid: string;
  from_status?: LeadStatus;
  to_status?: LeadStatus;
  keyword: string;
  hook_style: string;
  hook_text: string;
  persona: string;
  interaction_time: string;
  days_to_convert?: number;
  metadata?: Record<string, unknown>;
  touchpoint_type?: string;
  touchpoint_channel?: string;
  touchpoint_result?: 'opened' | 'replied' | 'booked' | 'no_response';
}

export interface KeywordPerformance {
  keyword: string;
  leads: number;
  conversions: number;
  rate: number;
  smoothed_rate: number;
  weight: number;
  suggested_weight?: number;
  auto_apply: boolean;
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
  value_score: number;
}

export interface BestInteractionTimes {
  persona: string;
  hours: Array<{
    weekday: number;
    hour: number;
    rate: number;
    sample: number;
  }>;
}

export interface WeeklyInsights {
  week_start: string;
  learning_period_complete: boolean;
  keyword_performance: KeywordPerformance[];
  hook_style_performance: HookStylePerformance[];
  persona_value: PersonaValue[];
  best_interaction_times: BestInteractionTimes[];
  generated_at: string;
}

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
  updateLeadFields(cid: string, fields: Partial<Lead>): Promise<void>;
  listLeads(filter?: LeadFilter): Promise<Lead[]>;
  ping(): Promise<boolean>;
}

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
  aweme_id?: string;
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

export interface ChannelQpsLimit {
  qps?: number;
  burst?: number;
}

export interface ChannelDailyQuota {
  total?: number | null;
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

export interface NotificationMessage {
  title?: string;
  body: string;
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

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly model: string;
}

export interface SystemStats {
  daysSinceStart: number;
  totalLeads: number;
  leadsByPersona: Record<string, number>;
  leadsByStatus: Record<LeadStatus, number>;
  conversionRate: number;
  costThisMonth: number;
  revenueThisMonth: number;
  lastRunAt: string;
  lastRunStatus: 'success' | 'failed' | 'partial';
}
