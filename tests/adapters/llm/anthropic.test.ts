import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicLLM } from '../../../src/adapters/llm/anthropic.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe('AnthropicLLM', () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it('complete happy path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hello, world!' }],
      }),
    });

    const llm = new AnthropicLLM('test-key');
    const result = await llm.complete('say hi');
    expect(result).toBe('Hello, world!');
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
    }));
  });

  it('complete error path', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const llm = new AnthropicLLM('bad-key');
    await expect(llm.complete('ping')).rejects.toThrow('Anthropic API 401');
  });

  it('ping returns ok+latency', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'pong' }] }),
    });

    const llm = new AnthropicLLM('test-key');
    const result = await llm.ping();
    expect(result.ok).toBe(true);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('ping returns not ok on error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Error' });
    const llm = new AnthropicLLM('test-key');
    const result = await llm.ping();
    expect(result.ok).toBe(false);
  });

  it('embed returns zero vector', async () => {
    const llm = new AnthropicLLM('test-key');
    const vec = await llm.embed('hello');
    expect(vec).toHaveLength(1536);
    expect(vec.every(n => n === 0)).toBe(true);
  });

  it('requires API key', () => {
    expect(() => new AnthropicLLM('')).toThrow('ANTHROPIC_API_KEY');
  });

  it('has correct capabilities and pricing', () => {
    const llm = new AnthropicLLM('test-key');
    expect(llm.capabilities.vision).toBe(true);
    expect(llm.capabilities.contextWindow).toBe(200_000);
    expect(llm.pricing.inputPerMTok).toBe(3.0);
  });
});