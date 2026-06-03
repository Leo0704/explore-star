/**
 * channel-errors 单元测试 —— LoginRequiredError
 */

import { describe, it, expect } from 'vitest';
import { LoginRequiredError } from '../../src/core/channel-errors.js';

describe('LoginRequiredError', () => {
  it('code === "LOGIN_REQUIRED"（与 R1 兼容）', () => {
    const e = new LoginRequiredError();
    expect(e.code).toBe('LOGIN_REQUIRED');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(LoginRequiredError);
  });
});
