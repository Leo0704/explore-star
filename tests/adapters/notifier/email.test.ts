import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailNotifier } from '../../../src/adapters/notifier/email.js';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe('EmailNotifier', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.TO_EMAIL = 'test@example.com';
    process.env.SMTP_URL = 'smtp://resend:re_testkey@localhost';
    process.env.SMTP_FROM = 'noreply@explore-star.com';
  });

  it('send happy path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'email-abc123' }),
    });

    const notifier = new EmailNotifier('test@example.com', 'smtp://resend:re_testkey@host');
    const result = await notifier.send({ title: '探星通知', body: '这是一封测试邮件。' });
    expect(result.ok).toBe(true);
    expect(result.message_id).toBe('email-abc123');
  });

  it('send error path', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const notifier = new EmailNotifier('test@example.com', 'smtp://resend:bad@host');
    const result = await notifier.send({ body: 'test' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  it('send includes html body', async () => {
    let sentBody: unknown;
    fetchMock.mockImplementation(async (_url: string, opts?: { body?: string }) => {
      sentBody = opts?.body;
      return { ok: true, json: async () => ({ id: 'x' }) };
    });

    const notifier = new EmailNotifier('test@example.com', 'smtp://resend:key@host');
    await notifier.send({ title: 'Hello', body: 'Line1\nLine2' });
    const parsed = JSON.parse(sentBody as string);
    expect(parsed.html).toContain('<br>');
    expect(parsed.subject).toBe('Hello');
  });

  it('requires TO_EMAIL', () => {
    delete process.env.TO_EMAIL;
    expect(() => new EmailNotifier('', '')).toThrow('TO_EMAIL');
  });

  it('has correct name', () => {
    const notifier = new EmailNotifier('test@example.com', 'smtp://resend:key@host');
    expect(notifier.name).toBe('email');
  });
});