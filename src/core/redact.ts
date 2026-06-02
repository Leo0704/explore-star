/**
 * Secret redaction utility（用于 LLM/CRM adapter 错误信息脱敏）
 *
 * 上游错误响应体里可能携带：
 *   - x-api-key / Authorization header 回显
 *   - 业务方 .env / secrets 片段
 *   - 用户评论里粘贴的 token
 *
 * 在 throw new Error(...) 之前调用 redactSecrets() 把可疑 token 替换为 <REDACTED>，
 * 避免把密钥 / PII 写入日志 / 抛给上层 UI。
 *
 * 匹配规则（顺序敏感 — 更具体的在前）：
 *   - Bearer xxx                       → <REDACTED>
 *   - sk-xxxxxxxx (OpenAI/Anthropic)   → <REDACTED>
 *   - patxxx (Airtable PAT)            → <REDACTED>
 *   - 通用 32+ 位 token                → <REDACTED>
 */

const KEY_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /sk-[A-Za-z0-9]{20,}/g,
  /pat[A-Za-z0-9.]{20,}/gi,
  /\b[A-Za-z0-9_\-]{32,}\b/g,
];

const REDACTED = '<REDACTED>';

/**
 * 把文本里疑似 secret 的片段替换为 <REDACTED>。
 * 多次调用安全（幂等）。
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let r = text;
  for (const p of KEY_PATTERNS) {
    r = r.replace(p, REDACTED);
  }
  return r;
}
