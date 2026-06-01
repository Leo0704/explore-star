import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaLLM } from '../../../src/adapters/llm/ollama.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe('OllamaLLM', () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it('complete happy path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'Hello from Ollama!' } }),
    });

    const llm = new OllamaLLM('http://localhost:11434', 'qwen2.5');
    const result = await llm.complete('say hi');
    expect(result).toBe('Hello from Ollama!');
  });

  it('complete error path', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const llm = new OllamaLLM('http://localhost:11434', 'qwen2.5');
    await expect(llm.complete('ping')).rejects.toThrow('Ollama API 500');
  });

  it('embed happy path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });

    const llm = new OllamaLLM('http://localhost:11434', 'qwen2.5');
    const vec = await llm.embed('hello');
    expect(vec).toEqual([0.1, 0.2, 0.3]);
  });

  it('embed error path', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found' });
    const llm = new OllamaLLM('http://localhost:11434', 'qwen2.5');
    await expect(llm.embed('hi')).rejects.toThrow('Ollama embed API 404');
  });

  it('ping happy path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'pong' } }),
    });
    const llm = new OllamaLLM('http://localhost:11434', 'qwen2.5');
    const result = await llm.ping();
    expect(result.ok).toBe(true);
  });

  it('ping error path', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    const llm = new OllamaLLM('http://localhost:11434', 'qwen2.5');
    const result = await llm.ping();
    expect(result.ok).toBe(false);
  });

  it('has zero pricing (local/free)', () => {
    const llm = new OllamaLLM('http://localhost:11434', 'qwen2.5');
    expect(llm.pricing.inputPerMTok).toBe(0);
    expect(llm.capabilities.functionCalling).toBe(false);
  });
});