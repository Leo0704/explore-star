import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeishuWebhookNotifier } from '../../../src/adapters/notifier/feishu.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe('FeishuWebhookNotifier', () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it('send happy path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'ok' }),
    });

    const notifier = new FeishuWebhookNotifier('https://open.feishu.cn/mock');
    const result = await notifier.send({ title: '探星日报', body: '一切正常' });
    expect(result.ok).toBe(true);
    expect(result.message_id).toBeDefined();
  });

  it('send error path', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Error',
    });

    const notifier = new FeishuWebhookNotifier('https://open.feishu.cn/mock');
    const result = await notifier.send({ body: 'test' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  it('send returns error when code != 0', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 99999, msg: '请求错误' }),
    });

    const notifier = new FeishuWebhookNotifier('https://open.feishu.cn/mock');
    const result = await notifier.send({ body: 'test' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('请求错误');
  });

  it('send formats text with title and body', async () => {
    let sentBody: unknown;
    fetchMock.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      sentBody = opts?.body;
      return { ok: true, json: async () => ({ code: 0, msg: 'ok' }) };
    });

    const notifier = new FeishuWebhookNotifier('https://open.feishu.cn/mock');
    await notifier.send({ title: '标题', body: '内容\n第二行' });
    const parsed = JSON.parse(sentBody as string);
    expect(parsed.content.text).toContain('**标题**');
    expect(parsed.content.text).toContain('内容');
  });

  it('requires FEISHU_WEBHOOK_URL', () => {
    expect(() => new FeishuWebhookNotifier('')).toThrow('FEISHU_WEBHOOK_URL');
  });

  it('has correct name', () => {
    const notifier = new FeishuWebhookNotifier('https://open.feishu.cn/mock');
    expect(notifier.name).toBe('feishu');
  });
});