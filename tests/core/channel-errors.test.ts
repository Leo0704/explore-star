/**
 * channel-errors 单元测试 —— 4 类错误 + 映射器
 *
 * 覆盖（roadmap §2.5 验收）：
 *   - 4 类错误类的 code 常量
 *   - mapToChannelError() 对带 code 错误的原样返回
 *   - mapToChannelError() 对裸 Error 的关键字启发式映射
 *   - 未知错误不归并（原样返回）
 */

import { describe, it, expect } from 'vitest';
import {
  LoginRequiredError,
  RateLimitedError,
  AntiBotTriggeredError,
  ContentUnavailableError,
  mapToChannelError,
} from '../../src/core/channel-errors.js';

describe('4 类 channel error', () => {
  it('LoginRequiredError.code === "LOGIN_REQUIRED"（与 R1 兼容）', () => {
    const e = new LoginRequiredError();
    expect(e.code).toBe('LOGIN_REQUIRED');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(LoginRequiredError);
  });

  it('RateLimitedError.code === "RATE_LIMITED"', () => {
    const e = new RateLimitedError('too many requests');
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.message).toBe('too many requests');
  });

  it('AntiBotTriggeredError.code === "ANTI_BOT_TRIGGERED"', () => {
    const e = new AntiBotTriggeredError('captcha required');
    expect(e.code).toBe('ANTI_BOT_TRIGGERED');
  });

  it('ContentUnavailableError.code === "CONTENT_UNAVAILABLE"', () => {
    const e = new ContentUnavailableError('视频已删除');
    expect(e.code).toBe('CONTENT_UNAVAILABLE');
  });
});

describe('mapToChannelError', () => {
  it('带 code 的错误原样返回（不重复包装）', () => {
    const e = new RateLimitedError('429');
    const mapped = mapToChannelError(e);
    expect(mapped).toBe(e);
  });

  it('4 类 code 都识别', () => {
    for (const E of [LoginRequiredError, RateLimitedError, AntiBotTriggeredError, ContentUnavailableError]) {
      const e = new E('x');
      expect(mapToChannelError(e)).toBe(e);
    }
  });

  it('关键字映射：登录态失效 → LoginRequiredError', () => {
    const e = new Error('channel 登录态失效，请重新扫码');
    const mapped = mapToChannelError(e);
    expect(mapped).toBeInstanceOf(LoginRequiredError);
    expect((mapped as any).code).toBe('LOGIN_REQUIRED');
  });

  it('关键字映射：rate limit / 429 / 频次 → RateLimitedError', () => {
    expect(mapToChannelError(new Error('rate limit exceeded'))).toBeInstanceOf(RateLimitedError);
    expect(mapToChannelError(new Error('HTTP 429 Too Many Requests'))).toBeInstanceOf(RateLimitedError);
    expect(mapToChannelError(new Error('频次过高'))).toBeInstanceOf(RateLimitedError);
  });

  it('关键字映射：captcha / 滑块 / anti-bot → AntiBotTriggeredError', () => {
    expect(mapToChannelError(new Error('captcha required'))).toBeInstanceOf(AntiBotTriggeredError);
    expect(mapToChannelError(new Error('出现滑块验证'))).toBeInstanceOf(AntiBotTriggeredError);
    expect(mapToChannelError(new Error('anti-bot detected'))).toBeInstanceOf(AntiBotTriggeredError);
  });

  it('关键字映射：not found / 已删除 / 审核 → ContentUnavailableError', () => {
    expect(mapToChannelError(new Error('video not found'))).toBeInstanceOf(ContentUnavailableError);
    expect(mapToChannelError(new Error('视频已删除'))).toBeInstanceOf(ContentUnavailableError);
    expect(mapToChannelError(new Error('内容审核中'))).toBeInstanceOf(ContentUnavailableError);
  });

  it('未知错误原样返回（不归并，保留信息）', () => {
    const e = new Error('something went wrong');
    const mapped = mapToChannelError(e);
    expect(mapped).toBe(e);
  });

  it('非 Error 类型的 unknown 也能处理（转 Error）', () => {
    const mapped = mapToChannelError('登录失败');
    expect(mapped).toBeInstanceOf(LoginRequiredError);
  });

  it('关键字不区分大小写', () => {
    expect(mapToChannelError(new Error('LOGIN REQUIRED'))).toBeInstanceOf(LoginRequiredError);
    expect(mapToChannelError(new Error('RATE LIMIT'))).toBeInstanceOf(RateLimitedError);
  });
});
