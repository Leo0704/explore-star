import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WechatNotifier } from '../../../src/adapters/notifier/wechat.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe('WechatNotifier', () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it('send happy path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ errno: 0, serial: 'msg-123' }),
    });

    const notifier = new WechatNotifier('test-sendkey');
    const result = await notifier.send({ title: '探星早报', body: '今日任务：5条' });
    expect(result.ok).toBe(true);
    expect(result.message_id).toBe('msg-123');
  });

  it('send error path', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Server Error',
    });

    const notifier = new WechatNotifier('test-sendkey');
    const result = await notifier.send({ body: 'test' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  it('send returns error when errno != 0', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ errno: 1024, errmsg: 'SENDKEY 错误' }),
    });

    const notifier = new WechatNotifier('bad-sendkey');
    const result = await notifier.send({ body: 'test' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('SENDKEY 错误');
  });

  it('send includes actions as desp markdown links', async () => {
    let body = '';
    fetchMock.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      body = opts?.body ?? '';
      return { ok: true, json: async () => ({ errno: 0, serial: 'x' }) };
    });

    const notifier = new WechatNotifier('key');
    await notifier.send({
      title: '任务',
      body: '请处理',
      actions: [{ label: '查看', url: 'https://example.com' }],
    });
    // Server 酱使用 desp parameter which supports markdown links
    expect(body).toContain('desp=');
    expect(decodeURIComponent(body)).toContain('[查看](https://example.com)');
  });

  it('requires WECHAT_SC_KEY', () => {
    expect(() => new WechatNotifier('')).toThrow('WECHAT_SC_KEY');
  });

  it('has correct name', () => {
    const notifier = new WechatNotifier('key');
    expect(notifier.name).toBe('wechat');
  });
});