import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAICompatibleLLM } from '../../../src/adapters/llm/openai-compatible.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe('OpenAICompatibleLLM', () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it('embed uses this.opts.model (not hardcoded text-embedding-3-small)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    });

    const llm = new OpenAICompatibleLLM({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-large',
    });
    await llm.embed('hello');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('text-embedding-3-large');
    expect(body.input).toBe('hello');
  });

  it('embed works with deepseek baseUrl (model still respected)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1] }] }),
    });

    const llm = new OpenAICompatibleLLM({
      apiKey: 'test-key',
      model: 'deepseek-chat',
    });
    await llm.embed('hi');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/embeddings');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('deepseek-chat');
  });

  it('embed returns embedding array', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.4, 0.5, 0.6] }] }),
    });

    const llm = new OpenAICompatibleLLM({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
    });
    const vec = await llm.embed('test');
    expect(vec).toEqual([0.4, 0.5, 0.6]);
  });

  it('requires apiKey', () => {
    expect(() => new OpenAICompatibleLLM({ apiKey: '', model: 'x' })).toThrow('apiKey');
  });
});
