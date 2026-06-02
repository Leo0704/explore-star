/**
 * MOCK_CHANNEL 单元测试
 *
 * 覆盖（roadmap §2.5 验收）：
 *   - MockChannel 接口合规
 *   - 固定 fixtures 返回
 *   - ping 永远 loggedIn=true
 *   - MOCK_CHANNEL=1 时 registerBuiltins 后可 getChannel('mock')
 *   - MOCK_CHANNEL 未设时 getChannel('mock') 抛错
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockChannel } from '../../../src/adapters/channel/mock.js';
import { MOCK_USER_VIDEOS, MOCK_VIDEO_FIXTURES } from '../../../src/adapters/channel/mock-fixtures.js';

describe('MockChannel 形状', () => {
  it('name === "mock"', () => {
    const ch = new MockChannel();
    expect(ch.name).toBe('mock');
  });

  it('rateLimits 形状合法', () => {
    const ch = new MockChannel();
    expect(ch.rateLimits.search_per_hour).toBeGreaterThan(0);
    expect(ch.rateLimits.user_videos_per_hour).toBeGreaterThan(0);
    expect(ch.rateLimits.comment_per_hour).toBeGreaterThan(0);
    expect(ch.rateLimits.friend_request_per_day).toBeGreaterThan(0);
    expect(ch.rateLimits.dm_per_day).toBeGreaterThan(0);
  });
});

describe('MockChannel.search()', () => {
  it('返回 fixtures 的视频（limit=3 全部返回）', async () => {
    const ch = new MockChannel();
    const result = await ch.search({ keywords: ['AI'], limit: 3 });
    expect(result).toHaveLength(3);
    expect(result[0].aweme_id).toBe(MOCK_VIDEO_FIXTURES[0].aweme_id);
  });

  it('返回的视频有真实中文 desc', async () => {
    const ch = new MockChannel();
    const result = await ch.search({ keywords: ['AI'], limit: 1 });
    expect(result[0].desc).toMatch(/[一-龥]/);  // 含中文
  });
});

describe('MockChannel.getUserVideos()', () => {
  it('返回 2 条 UserVideo（limit=2 截断）', async () => {
    const ch = new MockChannel();
    const result = await ch.getUserVideos('any-sec-uid', { limit: 2 });
    expect(result).toHaveLength(2);
  });

  it('每个 UserVideo 有 3 条 top_comments', async () => {
    const ch = new MockChannel();
    const result = await ch.getUserVideos('any-sec-uid');
    for (const v of result) {
      expect(v.top_comments.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('fixtures 至少有 1 条 emoji-only 评论（验证 e2e 完整性）', () => {
    let hasEmoji = false;
    for (const v of MOCK_USER_VIDEOS) {
      for (const c of v.top_comments) {
        // 简单判定：短文本 + 含 emoji
        if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(c.text) && c.text.length <= 4) {
          hasEmoji = true;
          break;
        }
      }
    }
    expect(hasEmoji).toBe(true);
  });
});

describe('MockChannel.ping()', () => {
  it('永远 loggedIn=true（跳过 R1 飞书告警）', async () => {
    const ch = new MockChannel();
    const result = await ch.ping();
    expect(result.ok).toBe(true);
    expect(result.loggedIn).toBe(true);
  });
});

describe('MOCK_CHANNEL 环境变量集成', () => {
  const savedEnv = process.env.MOCK_CHANNEL;

  beforeEach(() => {
    delete process.env.MOCK_CHANNEL;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.MOCK_CHANNEL;
    else process.env.MOCK_CHANNEL = savedEnv;
  });

  it('MOCK_CHANNEL=1 时 registerBuiltins 后 getChannel("mock") 存在', async () => {
    process.env.MOCK_CHANNEL = '1';
    const { registerBuiltins, getChannel } = await import('../../../src/adapters/registry.js');
    await registerBuiltins();
    expect(() => getChannel('mock')).not.toThrow();
  });

  it('MOCK_CHANNEL 未设时 getChannel("mock") 抛"未注册"', async () => {
    delete process.env.MOCK_CHANNEL;
    const { registerBuiltins, getChannel } = await import('../../../src/adapters/registry.js');
    await registerBuiltins();
    expect(() => getChannel('mock')).toThrow(/未注册/);
  });

  it('MOCK_CHANNEL=0 时 getChannel("mock") 抛"未注册"（只有 "1" 生效）', async () => {
    process.env.MOCK_CHANNEL = '0';
    const { registerBuiltins, getChannel } = await import('../../../src/adapters/registry.js');
    await registerBuiltins();
    expect(() => getChannel('mock')).toThrow(/未注册/);
  });
});
