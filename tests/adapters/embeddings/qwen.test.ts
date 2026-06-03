import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QwenEmbedding } from '../../../src/adapters/embeddings/qwen.js';

function makeOkResponse(embeddings: number[][]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => '',
    json: async () => ({ data: embeddings.map((embedding) => ({ embedding })) }),
  } as Response;
}

function makeErrorResponse(status: number, msg: string): Response {
  return {
    ok: false,
    status,
    statusText: 'ERR',
    text: async () => msg,
    json: async () => ({}),
  } as Response;
}

describe('QwenEmbedding', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('默认 baseUrl/model/dimensions 正确', () => {
    const e = new QwenEmbedding({ apiKey: 'sk-test' });
    expect(e.model).toBe('text-embedding-v3');
    expect(e.dimensions).toBe(1024);
  });

  it('embed 单条：发对 URL/headers/body，解析响应', async () => {
    const vec = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    fetchSpy.mockResolvedValueOnce(makeOkResponse([vec]));

    const e = new QwenEmbedding({ apiKey: 'sk-test' });
    const out = await e.embed('hello');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://dashscope.aliyun.com/compatible-mode/v1/embeddings');

    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('text-embedding-v3');
    expect(body.input).toEqual(['hello']);
    expect(body.dimensions).toBe(1024);

    expect(out).toEqual(vec);
    expect(out).toHaveLength(1024);
  });

  it('embedBatch 批量：input 是字符串数组', async () => {
    const v1 = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    const v2 = Array.from({ length: 1024 }, (_, i) => i * 0.002);
    fetchSpy.mockResolvedValueOnce(makeOkResponse([v1, v2]));

    const e = new QwenEmbedding({ apiKey: 'sk-test' });
    const out = await e.embedBatch(['a', 'b']);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.input).toEqual(['a', 'b']);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(v1);
    expect(out[1]).toEqual(v2);
  });

  it('空 batch 直接返回空数组，不发请求', async () => {
    const e = new QwenEmbedding({ apiKey: 'sk-test' });
    const out = await e.embedBatch([]);
    expect(out).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('API 返回 4xx/5xx 时抛出含状态码的错误', async () => {
    fetchSpy.mockResolvedValueOnce(makeErrorResponse(401, 'invalid api key'));

    const e = new QwenEmbedding({ apiKey: 'sk-bad' });
    await expect(e.embed('hi')).rejects.toThrow(/通义 Embeddings API 401/);
  });

  it('可自定义 baseUrl（支持私有化部署）', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse([Array(1024).fill(0)]));

    const e = new QwenEmbedding({
      apiKey: 'sk-test',
      baseUrl: 'https://my-private-qwen.example.com/v1/',
    });
    await e.embed('x');

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://my-private-qwen.example.com/v1/embeddings');
  });

  it('可切换到 text-embedding-v2（1536 维）', async () => {
    const e = new QwenEmbedding({
      apiKey: 'sk-test',
      model: 'text-embedding-v2',
      dimensions: 1536,
    });
    expect(e.model).toBe('text-embedding-v2');
    expect(e.dimensions).toBe(1536);
  });
});
