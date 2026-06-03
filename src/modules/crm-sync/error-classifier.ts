/**
 * CRM 错误分类（4 类）
 *
 * 设计：
 *   - 基于错误消息文本匹配，**不**做 schema parse（避免信息损失）
 *   - regex 大小写不敏感，同时匹配中英文
 *   - 永远返回一个 category（**不**抛错），便于失败路径不会引入二级 throw
 *
 * 类别与触发模式（spec §2.2）：
 *   rate_limited:    /rate.?limit|429|too.?many.?requests|throttle|限流/i
 *   auth_failed:     /auth|401|403|token|credential|expired|凭证/i
 *   schema_invalid:  /schema|field|required|missing|invalid|422|字段/i
 *   unknown:         其他
 */

export type CrmErrorCategory = 'rate_limited' | 'auth_failed' | 'schema_invalid' | 'unknown';

const PATTERNS: Record<Exclude<CrmErrorCategory, 'unknown'>, RegExp> = {
  rate_limited: /rate.?limit|429|too.?many.?requests|throttle|限流/i,
  auth_failed: /auth|401|403|token|credential|expired|凭证/i,
  schema_invalid: /schema|field|required|missing|invalid|422|字段/i,
};

export function classifyCrmError(err: Error | string): CrmErrorCategory {
  const msg = err instanceof Error ? err.message : String(err);
  for (const [category, pattern] of Object.entries(PATTERNS) as Array<[Exclude<CrmErrorCategory, 'unknown'>, RegExp]>) {
    if (pattern.test(msg)) return category;
  }
  return 'unknown';
}
