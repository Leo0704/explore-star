import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from '../../../src/adapters/llm/_retry.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe('fetchWithRetry', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately on 200', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: { get: () => null },
    });

    const p = fetchWithRetry('https://example.com', { method: 'POST' }, { baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 429, ok: false, headers: { get: () => null } })
      .mockResolvedValueOnce({ status: 200, ok: true, headers: { get: () => null } });

    const p = fetchWithRetry('https://example.com', { method: 'POST' }, { baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After header on 429', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 429,
        ok: false,
        headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? '2' : null) },
      })
      .mockResolvedValueOnce({ status: 200, ok: true, headers: { get: () => null } });

    const p = fetchWithRetry('https://example.com', { method: 'POST' }, { baseDelayMs: 1 });
    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    const res = await p;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws "Exceeded max retries" after persistent 500s', async () => {
    fetchMock.mockResolvedValue({ status: 500, ok: false, headers: { get: () => null } });

    const p = fetchWithRetry(
      'https://example.com',
      { method: 'POST' },
      { maxRetries: 2, baseDelayMs: 1 },
    );
    const settled = p.then(
      r => ({ ok: true as const, value: r }),
      e => ({ ok: false as const, error: e }),
    );
    await vi.runAllTimersAsync();
    const result = await settled;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(500);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on ECONNRESET then succeeds', async () => {
    const econn: NodeJS.ErrnoException = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    fetchMock
      .mockRejectedValueOnce(econn)
      .mockResolvedValueOnce({ status: 200, ok: true, headers: { get: () => null } });

    const p = fetchWithRetry('https://example.com', { method: 'POST' }, { baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on AbortError (timeout) then succeeds', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce({ status: 200, ok: true, headers: { get: () => null } });

    const p = fetchWithRetry('https://example.com', { method: 'POST' }, { baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable error (e.g. TypeError)', async () => {
    fetchMock.mockRejectedValue(new TypeError('bad url'));

    const p = fetchWithRetry('https://example.com', { method: 'POST' }, { baseDelayMs: 1 });
    const settled = p.catch(e => e);
    await vi.runAllTimersAsync();
    const err = await settled;

    expect(err).toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('eventually throws after persistent ECONNRESET', async () => {
    const econn = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    fetchMock.mockRejectedValue(econn);

    const p = fetchWithRetry(
      'https://example.com',
      { method: 'POST' },
      { maxRetries: 2, baseDelayMs: 1 },
    );
    const settled = p.catch(e => e);
    await vi.runAllTimersAsync();
    const err = await settled;

    expect((err as Error).message).toBe('reset');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('passes through 4xx (non-429) without retry', async () => {
    fetchMock.mockResolvedValueOnce({ status: 400, ok: false, headers: { get: () => null } });

    const p = fetchWithRetry('https://example.com', { method: 'POST' }, { baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
