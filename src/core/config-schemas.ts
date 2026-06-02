/**
 * 启动时 zod schema 校验 —— loadBusinessProfile / loadSafetyConfig 入口用
 *
 * 设计：
 *   - 只校验 spec 要求的字段（YAGNI：channels/conversion 不在这里）
 *   - 严格校验（positive int / non-empty string / enum）—— 防止 "配错字段 → 静默默认值"
 *   - 顶层 .passthrough()：保留 SafetyConfig 接口以外的字段（如 hook_review / browser），
 *     这些字段用 `as any` 访问，不参与严格校验
 *
 * 注意：types.ts 是单一真相源；本文件只负责运行时校验，不导出 type。
 */

import { z } from 'zod';

// ============================================================================
// 基础原子类型
// ============================================================================

const NonEmptyString = z.string().min(1, '不能为空');

// ============================================================================
// 1. SafetyConfig (config/safety.json)
// ============================================================================

const SafetyRateLimitsSchema = z.object({
  douyin: z.object({
    search_calls_per_hour: z.number().int().positive('必须 ≥ 1'),
    user_videos_calls_per_hour: z.number().int().positive('必须 ≥ 1'),
    friend_request_per_day: z.number().int().positive('必须 ≥ 1'),
    dm_per_day: z.number().int().positive('必须 ≥ 1'),
  }),
  min_interval_seconds: z.number().int().positive('必须 ≥ 1'),
  max_interval_seconds: z.number().int().positive('必须 ≥ 1'),
}).refine(
  (cfg) => cfg.max_interval_seconds >= cfg.min_interval_seconds,
  { message: 'max_interval_seconds 必须 ≥ min_interval_seconds', path: ['max_interval_seconds'] },
);

const SafetyDailyBudgetSchema = z.object({
  videos: z.number().int().positive('必须 ≥ 1'),
  comments_scanned: z.number().int().positive('必须 ≥ 1'),
  leads_created: z.number().int().positive('必须 ≥ 1'),
  engagement_actions: z.number().int().positive('必须 ≥ 1'),
});

export const safetyConfigSchema = z.object({
  rate_limits: SafetyRateLimitsSchema,
  daily_budget: SafetyDailyBudgetSchema,
  emergency_stop: NonEmptyString,
  fatal_signals: z.array(NonEmptyString).min(1, '至少 1 个 fatal signal'),
}).passthrough();

// ============================================================================
// 2. BusinessProfile (business/profile.yaml)
// ============================================================================

const LLMProviderSchema = z.enum(['openai', 'deepseek', 'anthropic', 'ollama', 'custom']);
const CRMTypeSchema = z.enum(['feishu', 'notion', 'airtable', 'csv', 'custom']);

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

export const businessProfileSchema = z.object({
  business: z.object({
    name: NonEmptyString,
    value_prop: NonEmptyString,
    description: z.string().optional(),
  }).passthrough(),
  target_personas: z.array(PersonaSchema).min(1, '至少 1 个 persona'),
  intent_signals: z.array(NonEmptyString).min(1, '至少 1 个意图信号词（供意图分析 prompt 用）'),
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
  observability: z.object({
    run_history: z.object({
      enabled: z.boolean().optional(),
    }).passthrough().optional(),
    notifier: z.object({
      enabled: z.boolean().optional(),
      channels: z.array(NonEmptyString).optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
  prompts_dir: z.string().optional(),
  knowledge_dir: z.string().optional(),
}).passthrough();

// ============================================================================
// 3. 错误格式化
// ============================================================================

export function formatZodError(prefix: string, error: z.ZodError): string {
  const issues = error.issues
    .map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  return `${prefix} 校验失败 (${error.issues.length} 个问题):\n${issues}`;
}

// ============================================================================
// 4. RetryConfig (profile.yaml — retry_config 块，Phase 1 #2)
// ============================================================================

export const RetryConfigSchema = z.object({
  comment_level: z.object({
    enabled: z.boolean().default(true),
    max_attempts: z.number().int().positive().default(2),
  }).passthrough().optional(),
  lead_level: z.object({
    enabled: z.boolean().default(true),
    max_attempts: z.number().int().positive().default(3),
    backoff_ms: z.array(z.number().int().positive()).default([1000, 2000, 4000]),
    classify_errors: z.boolean().default(true),
  }).passthrough().optional(),
  step_level: z.object({
    enabled: z.boolean().default(true),
    max_browser_restarts: z.number().int().min(0).max(3).default(1),
  }).passthrough().optional(),
}).passthrough().optional();

// ============================================================================
// 5. StructuredError (RunDailyResult.errors 元素，Phase 1 #2)
// ============================================================================

export const StructuredErrorSchema = z.object({
  phase: z.string().min(1),
  severity: z.enum(['fatal', 'partial']),
  error: z.string().min(1),
  count: z.number().int().positive(),
});

export type StructuredError = z.infer<typeof StructuredErrorSchema>;

// ============================================================================
// 6. ChannelRateLimits (channels.yaml — channel_rate_limits 块，Phase 1 #2)
// ============================================================================

const ChannelRateLimitsDouyinSchema = z.object({
  search_qps: z.number().min(0),
  user_videos_qps: z.number().min(0),
  comment_qps: z.number().min(0),
  friend_request_per_day: z.number().int().min(0),
  dm_per_day: z.number().int().min(0),
});

export const ChannelRateLimitsSchema = z.object({
  douyin: ChannelRateLimitsDouyinSchema,
}).passthrough();
