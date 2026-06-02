/**
 * Zod schemas（运行时校验层）
 *
 * 与 src/core/types.ts 的纯 TS interface 配对：
 *   - interface 用于编译期类型检查
 *   - zod schema 用于运行时数据校验（写入 events.jsonl、API 边界等）
 *
 * 当前仅含 LeadEventSchema（F12 修复需要）。
 * 后续如有其他 schema 校验需求，遵循同样模式。
 */

import { z } from 'zod';
import { NonEmptyString } from './schemas-helpers.js';

/**
 * LeadEvent 事件的 zod schema。
 *
 * 与 types.ts 的 LeadEvent interface 配对，但**枚举校验更严格**（zod enum
 * 拒绝未列出的 event 字符串，而 TS interface 在 strict 模式外是宽松的）。
 */
export const LeadEventSchema = z.object({
  event: z.enum([
    'lead_status_changed',
    'lead_created',
    'task_executed',
    'touchpoint_sent',
    'touchpoint_replied',
  ]),
  cid: NonEmptyString,
  from_status: z.string().optional(),
  to_status: z.string().optional(),
  keyword: z.string(),
  hook_style: z.string(),
  hook_text: z.string(),
  persona: z.string(),
  interaction_time: z.string(),
  days_to_convert: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Touchpoint-specific fields (F12: §3.10 触达方式归因回路)
  touchpoint_type: z.string().optional(),
  touchpoint_channel: z.string().optional(),
  touchpoint_result: z
    .enum(['opened', 'replied', 'booked', 'no_response'])
    .optional(),
});

export type LeadEventParsed = z.infer<typeof LeadEventSchema>;
