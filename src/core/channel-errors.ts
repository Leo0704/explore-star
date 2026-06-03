/**
 * 渠道错误类型
 *
 * LoginRequired：登录态失效
 */

export class LoginRequiredError extends Error {
  readonly code = 'LOGIN_REQUIRED' as const;
  constructor(message = '检测到登录态失效') {
    super(message);
    this.name = 'LoginRequiredError';
  }
}
