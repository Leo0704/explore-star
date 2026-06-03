/**
 * 共享 fetch 重试 helper(LLM adapters 用)
 *
 * 重试策略:
 *   - 429 / 5xx: 指数退避(优先用 Retry-After header)
 *   - AbortError / ECONNRESET / ETIMEDOUT: 指数退避
 *   - 其他错误: 直接抛出
 *
 * 默认: maxRetries=3, baseDelayMs=1000, timeoutMs=30000
 */

export interface FetchWithRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

interface NodeErrno extends Error {
  code?: string;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const { maxRetries = 3, baseDelayMs = 1000, timeoutMs = 30000 } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }

      // 429 / 5xx 重试
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < maxRetries) {
          const retryAfterRaw = res.headers?.get?.('retry-after');
          let retryAfterMs = 0;
          if (retryAfterRaw) {
            if (/^[0-9]+$/.test(retryAfterRaw)) {
              // delta-seconds
              retryAfterMs = Number(retryAfterRaw) * 1000;
            } else {
              // HTTP-date
              const dateMs = Date.parse(retryAfterRaw);
              if (!Number.isNaN(dateMs)) {
                retryAfterMs = Math.max(0, dateMs - Date.now());
              }
            }
          }
          const delay = retryAfterMs > 0 ? retryAfterMs : baseDelayMs * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
      }
      return res;
    } catch (err) {
      const e = err as NodeErrno;
      const isRetryable =
        e?.name === 'AbortError' ||
        e?.code === 'ECONNRESET' ||
        e?.code === 'ETIMEDOUT' ||
        e?.code === 'ECONNREFUSED' ||
        e?.code === 'ENOTFOUND';
      if (attempt < maxRetries && isRetryable) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Exceeded max retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
