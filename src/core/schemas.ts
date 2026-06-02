/**
 * Zod schemas for runtime validation of YAML/JSON config files
 *
 * 用途:
 *   - 业务方 yaml 配置 (profile/channels/crm/conversion) 在 parse 后立即校验,
 *     防止"配置错误 → 运行时类型不匹配"延迟暴露
 *   - 已知字段类型严格,未知字段用 .passthrough() 保留 (业务方可能扩展)
 *
 * 设计原则:
 *   - 严格 null/undefined 区分 (与 types.ts 对齐)
 *   - 必填字段 (profile.yaml 的 business.name 等) 用 min(1) 而非 optional
 *   - 与 src/core/types.ts 中接口形态对应,类型推断用 z.infer<>
 *
 * 注意: z.infer 出来的类型与 types.ts 中的 interface 在细微处可能不完全一致
 * (例如 enum 字面量 union 在 zod 端需要显式列举)。types.ts 是单一真相源,
 * 本文件只负责**运行时校验**——类型不一致时以 types.ts 为准。
 */

import { z } from 'zod';

// ============================================================================
// 基础原子类型
// ============================================================================

const Iso8601 = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  '必须是 ISO 8601 格式',
);

const NonEmptyString = z.string().min(1, '不能为空');

// ============================================================================
// 1. BusinessProfile  →  profile.yaml
// ============================================================================

export const LLMProviderSchema = z.enum([
  'openai', 'deepseek', 'anthropic', 'ollama', 'custom',
]);

export const CRMTypeSchema = z.enum([
  'feishu', 'notion', 'airtable', 'csv', 'custom',
]);

const PersonaSchema = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
  description: z.string().optional(),
  typical_pain_points: z.array(NonEmptyString).min(1, '至少 1 个典型痛点'),
  value_score: z.number().min(0).max(10).optional(),
}).passthrough();

const BuyingStageSchema = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
  description: NonEmptyString,
}).passthrough();

const LLMConfigSchema = z.object({
  provider: LLMProviderSchema,
  model: NonEmptyString,
  api_key_env: NonEmptyString,
  base_url: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  fallback: z.array(z.object({
    provider: LLMProviderSchema,
    model: NonEmptyString,
  }).passthrough()).optional(),
}).passthrough();

const CRMConfigSchema = z.object({
  type: CRMTypeSchema,
  config: z.record(z.string(), z.unknown()),
  field_mapping: z.record(z.string(), z.string()).optional(),
}).passthrough();

export const BusinessProfileSchema = z.object({
  business: z.object({
    name: NonEmptyString,
    value_prop: NonEmptyString,
    description: z.string().optional(),
  }).passthrough(),
  target_personas: z.array(PersonaSchema).min(1, '至少 1 个 persona'),
  intent_signals: z.array(NonEmptyString).min(1, '至少 1 个意图信号词'),
  buying_stages: z.array(BuyingStageSchema).optional(),
  llm: LLMConfigSchema,
  crm: CRMConfigSchema,
  hook_config: z.object({
    style: z.string().optional(),
    max_length: z.number().int().positive().optional(),
    language: z.string().optional(),
    styles: z.array(z.string()).optional(),
  }).passthrough().optional(),
  feedback_config: z.object({
    auto_apply: z.object({
      keyword_weight: z.boolean().optional(),
      hook_style: z.boolean().optional(),
      persona_value: z.boolean().optional(),
      interaction_time: z.boolean().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
  prompts_dir: z.string().optional(),
  knowledge_dir: z.string().optional(),
}).passthrough();

// ============================================================================
// 2. ChannelsConfig  →  channels.yaml
// ============================================================================

export const ChannelsConfigSchema = z.object({
  source: z.object({
    mode: z.enum(['sec_uid', 'keyword', 'both']),
  }).passthrough().optional(),
  search: z.object({
    keywords: z.record(z.string(), z.object({ weight: z.number() }).passthrough()),
    limit_per_keyword: z.number().int().positive().max(30).optional(),
  }).passthrough().optional(),
  target_sec_uids: z.object({
    sec_uids: z.array(NonEmptyString),
    user_videos_limit: z.number().int().positive().max(20).optional(),
    comment_limit: z.number().int().positive().max(10).optional(),
  }).passthrough().optional(),
  filters: z.object({
    min_likes: z.number().int().nonnegative().optional(),
    max_age_days: z.number().int().positive().optional(),
  }).passthrough().optional(),
  comment_filters: z.object({
    min_length: z.number().int().nonnegative().optional(),
    exclude_emoji_only: z.boolean().optional(),
    exclude_punctuation_only: z.boolean().optional(),
    exclude_marketing: z.boolean().optional(),
  }).passthrough().optional(),
}).passthrough();

// ============================================================================
// 3. CRM 配置文件  →  crm.yaml
// (与 BusinessProfile.crm 类似但更详细,带 field_mapping)
// ============================================================================

export const CrmConfigSchema = z.object({
  crm: z.object({
    type: CRMTypeSchema,
    config: z.object({
      app_id_env: z.string().optional(),
      app_secret_env: z.string().optional(),
      table_id: z.string().optional(),
    }).passthrough(),
    field_mapping: z.record(z.string(), z.string()).optional(),
    persona_options: z.array(z.string()).optional(),
    status_options: z.array(z.string()).optional(),
  }).passthrough(),
}).passthrough();

// ============================================================================
// 4. ConversionConfig  →  conversion.yaml
// ============================================================================

const LifecycleStateSchema = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
  is_terminal: z.boolean(),
}).passthrough();

const BookingProviderSchema = z.object({
  type: z.enum(['feishu_calendar', 'webhook', 'manual']),
  config: z.record(z.string(), z.unknown()),
}).passthrough();

const PostAddAssetSchema = z.object({
  type: z.enum(['pdf', 'link', 'image']),
  name: NonEmptyString,
  path: NonEmptyString,
}).passthrough();

const ReactivationSchema = z.object({
  dormant_days: z.number().int().positive().optional(),
  max_attempts: z.number().int().nonnegative().optional(),
  message_template: z.string().optional(),
}).passthrough();

export const ConversionConfigSchema = z.object({
  lifecycle_states: z.array(LifecycleStateSchema).min(1, '至少 1 个 lifecycle_state'),
  success_states: z.array(NonEmptyString),
  post_add_asset: PostAddAssetSchema.optional(),
  booking_url: z.string().url().optional(),
  message_template: z.string().optional(),
  booking_provider: BookingProviderSchema.optional(),
  reactivation: ReactivationSchema.optional(),
  cost_per_lead: z.number().nonnegative().optional(),
  revenue_field: z.string().optional(),
}).passthrough();

// ============================================================================
// 5. PipelineState  →  data/state.json (断点续传)
// ============================================================================

export const PipelineStateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currentStep: z.number().int().min(0).max(6),
  steps: z.array(z.object({
    name: NonEmptyString,
    status: z.enum(['pending', 'running', 'completed', 'failed']),
    startedAt: Iso8601.optional(),
    completedAt: Iso8601.optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }).passthrough()),
  startedAt: Iso8601,
  lastUpdatedAt: Iso8601,
  errors: z.array(z.string()),
  completed: z.boolean(),
}).passthrough();

// ============================================================================
// 6. LeadEvent  →  data/events/lead-events-*.jsonl (反馈分析)
// ============================================================================

export const LeadEventSchema = z.object({
  event: z.enum(['lead_status_changed', 'lead_created', 'task_executed']),
  cid: NonEmptyString,
  from_status: z.string().optional(),
  to_status: z.string().optional(),
  keyword: z.string(),
  hook_style: z.string(),
  hook_text: z.string(),
  persona: z.string(),
  interaction_time: Iso8601,
  days_to_convert: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

// ============================================================================
// 7. Insights (hook_style_performance subset)  →  data/insights/weekly-insights.json
// ============================================================================

export const WeeklyInsightsSchema = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  learning_period_complete: z.boolean(),
  keyword_performance: z.array(z.object({
    keyword: z.string(),
    leads: z.number().int().nonnegative(),
    conversions: z.number().int().nonnegative(),
    rate: z.number().min(0).max(1),
    smoothed_rate: z.number().min(0).max(1),
    weight: z.number(),
    suggested_weight: z.number().optional(),
    auto_apply: z.boolean(),
  }).passthrough()).optional(),
  hook_style_performance: z.array(z.object({
    style: z.string(),
    tested: z.number().int().nonnegative(),
    replied: z.number().int().nonnegative(),
    rate: z.number().min(0).max(1),
  }).passthrough()).optional(),
  persona_value: z.array(z.object({
    persona: z.string(),
    leads: z.number().int().nonnegative(),
    conversions: z.number().int().nonnegative(),
    revenue: z.number().nonnegative(),
    value_score: z.number().min(0).max(10),
  }).passthrough()).optional(),
  best_interaction_times: z.array(z.object({
    persona: z.string(),
    hours: z.array(z.object({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      rate: z.number().min(0).max(1),
      sample: z.number().int().nonnegative(),
    }).passthrough()),
  }).passthrough()).optional(),
  generated_at: Iso8601,
}).passthrough();

// ============================================================================
// 8. SafetyConfig  →  config/safety.json (限速 & 紧急停止)
// ============================================================================

export const SafetyConfigSchema = z.object({
  daily_budget: z.object({
    engagement_actions: z.number().int().positive().optional(),
    llm_calls: z.number().int().positive().optional(),
    notifications: z.number().int().positive().optional(),
  }).passthrough().optional(),
  rate_limits: z.object({
    like_per_hour: z.number().int().positive().optional(),
    follow_per_hour: z.number().int().positive().optional(),
    comment_per_hour: z.number().int().positive().optional(),
    friend_request_per_day: z.number().int().positive().optional(),
    dm_per_day: z.number().int().positive().optional(),
  }).passthrough().optional(),
  emergency_stop: z.object({
    enabled: z.boolean().optional(),
    triggered_at: Iso8601.optional(),
    reason: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

// ============================================================================
// 9. Comment (analyze.ts CLI 输入)  →  data/tmp/comments.json
// ============================================================================

export const CommentInputSchema = z.object({
  cid: NonEmptyString,
  aweme_id: NonEmptyString,
  video_url: z.string(),
  video_desc: z.string(),
  keyword: z.string(),
  text: NonEmptyString,
  user: z.object({
    nickname: z.string(),
    uid: z.string(),
    follower_count: z.number().int().nonnegative(),
    signature: z.string(),
  }).passthrough(),
  digg_count: z.number().int().nonnegative(),
  create_time: z.union([Iso8601, z.number()]),
  reply_count: z.number().int().nonnegative(),
}).passthrough();

// ============================================================================
// Helper: 带行号/字段路径的格式错误
// ============================================================================

/**
 * 把 zod safeParse 的失败结果转成可读错误信息
 * 包含字段路径和预期类型
 */
export function formatZodError(prefix: string, error: z.ZodError): string {
  const issues = error.issues
    .map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  return `${prefix} 校验失败 (${error.issues.length} 个问题):\n${issues}`;
}
