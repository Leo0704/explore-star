/**
 * CRM 错误分类（4 类）单元测试
 *
 * 覆盖：
 *   - rate_limited（英文 + 中文）
 *   - auth_failed（401/403/中文）
 *   - schema_invalid（400/422/中文）
 *   - unknown fallback
 *   - Error 对象 vs 字符串
 *   - 大小写不敏感
 */

import { describe, it, expect } from 'vitest';
import { classifyCrmError } from '../../../src/modules/crm-sync/error-classifier.js';

describe('classifyCrmError', () => {
  it('detects rate_limited (英文)', () => {
    expect(classifyCrmError('rate limit exceeded')).toBe('rate_limited');
    expect(classifyCrmError('HTTP 429 too many requests')).toBe('rate_limited');
    expect(classifyCrmError('throttled by API')).toBe('rate_limited');
  });

  it('detects rate_limited (中文)', () => {
    expect(classifyCrmError('请求被限流')).toBe('rate_limited');
    expect(classifyCrmError('触发限流策略')).toBe('rate_limited');
  });

  it('detects auth_failed (401/403/中文)', () => {
    expect(classifyCrmError('401 unauthorized')).toBe('auth_failed');
    expect(classifyCrmError('403 forbidden, invalid token')).toBe('auth_failed');
    expect(classifyCrmError('token expired')).toBe('auth_failed');
    expect(classifyCrmError('凭证已过期')).toBe('auth_failed');
  });

  it('detects schema_invalid (400/422/中文)', () => {
    expect(classifyCrmError('400 bad request, missing field')).toBe('schema_invalid');
    expect(classifyCrmError('422 unprocessable entity, invalid schema')).toBe('schema_invalid');
    expect(classifyCrmError('字段缺失: name')).toBe('schema_invalid');
    expect(classifyCrmError('schema validation failed')).toBe('schema_invalid');
  });

  it('returns unknown for unclassified errors', () => {
    expect(classifyCrmError(new Error('connection reset'))).toBe('unknown');
    expect(classifyCrmError('something completely different')).toBe('unknown');
  });

  it('accepts Error objects (not just strings)', () => {
    expect(classifyCrmError(new Error('429 too many requests'))).toBe('rate_limited');
  });

  it('case-insensitive matching', () => {
    expect(classifyCrmError('RATE LIMIT')).toBe('rate_limited');
    expect(classifyCrmError('Auth Token Expired')).toBe('auth_failed');
  });
});
