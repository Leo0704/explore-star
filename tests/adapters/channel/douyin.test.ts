/**
 * DouyinChannel 单元测试
 *
 * 不真的调用 opencli —— 用 mock shellExec 注入 fake stdout
 */

import { describe, it, expect } from 'vitest';

import { DouyinChannel, extractAwemeId } from '../../../src/adapters/channel/douyin.js';

function mockChannel(stdout: string, error?: Error): DouyinChannel {
  return new DouyinChannel({
    shellExec: async (cmd, args) => {
      if (error) throw error;
      return stdout;
    },
  });
}

describe('DouyinChannel', () => {
  describe('extractAwemeId', () => {
    it('提取标准 url', () => {
      expect(extractAwemeId('https://www.douyin.com/video/7384958671234567890'))
        .toBe('7384958671234567890');
    });

    it('处理 protocol-relative url', () => {
      expect(extractAwemeId('//www.douyin.com/video/7384958671234567890'))
        .toBe('7384958671234567890');
    });

    it('处理 path-only url', () => {
      expect(extractAwemeId('/video/7384958671234567890')).toBe('7384958671234567890');
    });

    it('非抖音域名返回空', () => {
      expect(extractAwemeId('https://www.tiktok.com/video/123')).toBe('');
    });

    it('非法 url 返回空', () => {
      expect(extractAwemeId('not a url')).toBe('');
      expect(extractAwemeId('')).toBe('');
    });
  });

  describe('search', () => {
    it('单关键词 → 返回视频数组 + 从 url 提取 aweme_id', async () => {
      const ch = mockChannel(JSON.stringify([
        {
          rank: 1,
          desc: 'AI 剪辑能不能省人工',
          author: '小张',
          url: 'https://www.douyin.com/video/7384958671234567890',
          plays: 0, likes: 1240, comments: 0, shares: 0,
        },
      ]));
      const result = await ch.search({ keywords: ['AI 剪辑'], limit: 10 });
      expect(result).toHaveLength(1);
      expect(result[0].aweme_id).toBe('7384958671234567890');
      expect(result[0].likes).toBe(1240);
    });

    it('多关键词 → 循环调用并合并', async () => {
      let callCount = 0;
      const ch = new DouyinChannel({
        shellExec: async (cmd, args) => {
          callCount++;
          return JSON.stringify([{ rank: 1, desc: args[2], url: 'https://www.douyin.com/video/111', likes: 100, plays: 0, comments: 0, shares: 0 }]);
        },
      });
      const result = await ch.search({ keywords: ['A', 'B'], limit: 10 });
      expect(callCount).toBe(2);
      expect(result).toHaveLength(2);
    });

    it('空结果（EMPTY_RESULT）→ 跳过该关键词，不抛错', async () => {
      let callCount = 0;
      const ch = new DouyinChannel({
        shellExec: async (cmd, args) => {
          callCount++;
          if (args[2] === 'empty') {
            throw Object.assign(new Error('No Douyin videos matched "empty"'), { code: 'EMPTY_RESULT' });
          }
          return JSON.stringify([{ rank: 1, desc: 'A', url: 'https://www.douyin.com/video/111', likes: 1, plays: 0, comments: 0, shares: 0 }]);
        },
      });
      const result = await ch.search({ keywords: ['empty', 'A'], limit: 10 });
      expect(callCount).toBe(2);
      expect(result).toHaveLength(1);
      expect(result[0].desc).toBe('A');
    });

    it('登录墙（AUTH_REQUIRED）→ 抛出', async () => {
      const ch = mockChannel('', Object.assign(new Error('AuthRequiredError'), { code: 'AUTH_REQUIRED' }));
      await expect(ch.search({ keywords: ['X'], limit: 5 })).rejects.toThrow(/登录/);
    });

    it('limit 超过 30 → 自动钳到 30（opencli 硬上限）', async () => {
      let capturedArgs: string[] = [];
      const ch = new DouyinChannel({
        shellExec: async (cmd, args) => {
          capturedArgs = args;
          return '[]';
        },
      });
      await ch.search({ keywords: ['X'], limit: 100 });
      expect(capturedArgs).toContain('--limit');
      expect(capturedArgs[capturedArgs.indexOf('--limit') + 1]).toBe('30');
    });
  });

  describe('getUserVideos', () => {
    it('正确传参 + 返回结构', async () => {
      let capturedArgs: string[] = [];
      const ch = new DouyinChannel({
        shellExec: async (cmd, args) => {
          capturedArgs = args;
          return JSON.stringify([
            {
              index: 1,
              aweme_id: '7384958671234567890',
              title: 'AI 客服 怎么做',
              duration: 45,
              digg_count: 1240,
              play_url: 'https://...',
              top_comments: [
                { cid: 'c1', text: '求推荐', user: { nickname: 'A', uid: 'u1', follower_count: 100, signature: '' }, digg_count: 5, create_time: 1717200000, reply_count: 0 },
              ],
            },
          ]);
        },
      });

      const result = await ch.getUserVideos('MS4wLjABAAAAxxx', { limit: 5, commentLimit: 3 });
      expect(capturedArgs).toEqual([
        'douyin', 'user-videos', 'MS4wLjABAAAAxxx',
        '--limit', '5',
        '--with_comments', 'true',
        '--comment_limit', '3',
        '--format', 'json',
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].aweme_id).toBe('7384958671234567890');
      expect(result[0].top_comments).toHaveLength(1);
    });

    it('limit 默认 20 + comment_limit 默认 10', async () => {
      let capturedArgs: string[] = [];
      const ch = new DouyinChannel({
        shellExec: async (cmd, args) => {
          capturedArgs = args;
          return '[]';
        },
      });
      await ch.getUserVideos('MS4wLjABAAAAxxx');
      expect(capturedArgs).toContain('20');
      expect(capturedArgs).toContain('10');
    });

    it('withComments=false → 传 --with_comments false', async () => {
      let capturedArgs: string[] = [];
      const ch = new DouyinChannel({
        shellExec: async (cmd, args) => {
          capturedArgs = args;
          return '[]';
        },
      });
      await ch.getUserVideos('MS4wLjABAAAAxxx', { withComments: false });
      // opencli 默认 with_comments=true；要关闭必须显式传 false
      expect(capturedArgs).toContain('--with_comments');
      expect(capturedArgs[capturedArgs.indexOf('--with_comments') + 1]).toBe('false');
    });

    it('空 sec_uid → 抛错', async () => {
      const ch = new DouyinChannel({ shellExec: async () => '[]' });
      await expect(ch.getUserVideos('')).rejects.toThrow(/sec_uid/);
    });
  });

  describe('ping', () => {
    it('已登录 → ok=true, loggedIn=true', async () => {
      const ch = mockChannel(JSON.stringify({ uid: 'u1', nickname: 'Test', follower_count: 100 }));
      const r = await ch.ping();
      expect(r.ok).toBe(true);
      expect(r.loggedIn).toBe(true);
    });

    it('未登录 → ok=true, loggedIn=false', async () => {
      const ch = mockChannel(JSON.stringify({}));
      const r = await ch.ping();
      expect(r.ok).toBe(true);
      expect(r.loggedIn).toBe(false);
    });

    it('opencli 不可用 → ok=false', async () => {
      const ch = new DouyinChannel({
        shellExec: async () => { throw new Error('command not found'); },
      });
      const r = await ch.ping();
      expect(r.ok).toBe(false);
      expect(r.loggedIn).toBe(false);
    });
  });
});
