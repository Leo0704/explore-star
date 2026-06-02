/**
 * 渠道错误类型（Phase 3 #5 多渠道架构准备）
 *
 * 4 类平台共有错误（roadmap §2.5）：
 *   - LoginRequired：登录态失效
 *   - RateLimited：频率限制
 *   - AntiBotTriggered：反爬触发（验证码 / 滑块 / 指纹）
 *   - ContentUnavailable：内容不可用（已删除 / 审核中 / 私有）
 *
 * 映射器 `mapToChannelError()`：
 *   - 已是 4 类之一 → 原样返回
 *   - 裸 Error → 按 message 关键字启发式映射
 *   - 未知错误 → 原样返回（roadmap 明确不强制归并 NetworkError/Timeout/SchemaError，避免信息损失）
 *
 * 设计原则（来自 `docs/CLAUDE.md` §1 fail-loud）：
 *   永远保留原始错误对象（不丢 cause），让上层能拿 stack + message 做调试
 */

/** 4 类错误的 code 联合类型 */
export type ChannelErrorCode =
  | 'LOGIN_REQUIRED'
  | 'RATE_LIMITED'
  | 'ANTI_BOT_TRIGGERED'
  | 'CONTENT_UNAVAILABLE';

export class LoginRequiredError extends Error {
  readonly code = 'LOGIN_REQUIRED' as const;
  constructor(message = '检测到登录态失效') {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED' as const;
  constructor(message = '触发平台频率限制') {
    super(message);
    this.name = 'RateLimitedError';
  }
}

export class AntiBotTriggeredError extends Error {
  readonly code = 'ANTI_BOT_TRIGGERED' as const;
  constructor(message = '触发反爬验证') {
    super(message);
    this.name = 'AntiBotTriggeredError';
  }
}

export class ContentUnavailableError extends Error {
  readonly code = 'CONTENT_UNAVAILABLE' as const;
  constructor(message = '内容不可用（已删除/审核/私有）') {
    super(message);
    this.name = 'ContentUnavailableError';
  }
}

const KNOWN_CODES: ReadonlySet<ChannelErrorCode> = new Set([
  'LOGIN_REQUIRED',
  'RATE_LIMITED',
  'ANTI_BOT_TRIGGERED',
  'CONTENT_UNAVAILABLE',
]);

/** 关键字 → 错误类（不区分大小写） */
const KEYWORD_RULES: Array<{ pattern: RegExp; Ctor: new (msg: string) => Error }> = [
  // 登录态：覆盖常见中英文（last 防线，宽松匹配）
  { pattern: /登录(态)?(失效|失败|超时|过期|异常)?|login (required|fail|expired|invalid)|not logged in|cookies? (expired|invalid)|请重新扫码/, Ctor: LoginRequiredError },
  { pattern: /rate limit|429|too many requests|频次|quota exceeded/, Ctor: RateLimitedError },
  { pattern: /captcha|滑块|anti-?bot|verify.?code|人机验证|风控/, Ctor: AntiBotTriggeredError },
  { pattern: /not found|404|已删除|审核中|内容不可用|private|forbidden|无权访问/, Ctor: ContentUnavailableError },
];

/**
 * 把任何 unknown 错误归类为 4 类之一或原样返回。
 *
 * 行为：
 *   1. 已是 4 类错误（带 code）→ 原样返回
 *   2. 裸 Error → 按 message 关键字匹配（**最后一道防线**，不依赖此机制）
 *   3. 非 Error（string / object）→ 包装成 Error 后再走关键字
 *   4. 全部不匹配 → 原样返回
 */
export function mapToChannelError(e: unknown): Error {
  // 1. 已经是 4 类之一
  if (e instanceof Error && 'code' in e) {
    const code = (e as { code: unknown }).code;
    if (typeof code === 'string' && KNOWN_CODES.has(code as ChannelErrorCode)) {
      return e;
    }
  }

  // 2. 准备 message 文本
  const rawMessage = e instanceof Error
    ? e.message
    : typeof e === 'string'
      ? e
      : (() => {
          try { return String(e); } catch { return '未知错误'; }
        })();

  const lower = rawMessage.toLowerCase();

  // 3. 关键字匹配（顺序敏感：先精确后模糊）
  for (const { pattern, Ctor } of KEYWORD_RULES) {
    if (pattern.test(rawMessage) || pattern.test(lower)) {
      return new Ctor(rawMessage);
    }
  }

  // 4. 未知错误原样返回（保留 stack / 原始对象）
  if (e instanceof Error) return e;
  return new Error(rawMessage);
}
