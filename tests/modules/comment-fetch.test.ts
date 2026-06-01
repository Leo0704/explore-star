/**
 * comment-fetch 单元测试
 *
 * 测试覆盖：
 *   1. normalizeSearchResults / normalizeUserVideos
 *   2. deduplicateComments
 *   3. applyCommentFilters
 *   4. fetchComments 调度逻辑
 */

import { describe, it, expect } from 'vitest';
import type { Video, UserVideo, Comment, ChannelsConfig } from '../../src/core/types.js';
import { normalizeSearchResults, normalizeUserVideos, deduplicateComments } from '../../src/modules/comment-fetch/index.js';
import { applyCommentFilters } from '../../src/modules/comment-fetch/filters.js';
import { DouyinChannel } from '../../src/adapters/channel/douyin.js';

// ---------------------------------------------------------------------------
// 测试数据 fixtures
// ---------------------------------------------------------------------------

const mockSearchVideos: Video[] = [
  {
    rank: 1,
    desc: 'AI 剪辑教程',
    author: '小张',
    url: 'https://www.douyin.com/video/7384958671234567890',
    plays: 0, likes: 1240, comments: 0, shares: 0,
  },
];

const mockUserVideos: UserVideo[] = [
  {
    index: 1,
    aweme_id: '7384958671234567890',
    title: 'AI 客服怎么做',
    duration: 45,
    digg_count: 1240,
    play_url: 'https://...',
    top_comments: [
      {
        cid: 'c1',
        text: '求推荐好用的 AI 客服',
        user: { nickname: '电商小李', uid: 'u1', follower_count: 500, signature: '专注电商运营' },
        digg_count: 12,
        create_time: 1717200500,
        reply_count: 3,
      },
      {
        cid: 'c2',
        text: '👍👍👍',
        user: { nickname: '路人甲', uid: 'u2', follower_count: 10, signature: '' },
        digg_count: 1,
        create_time: 1717200600,
        reply_count: 0,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// index.ts 测试
// ---------------------------------------------------------------------------

describe('comment-fetch/index', () => {
  describe('normalizeSearchResults', () => {
    it('Video[] → Comment[]，aweme_id 从 url 提取', () => {
      const comments = normalizeSearchResults(mockSearchVideos, 'AI 客服');
      expect(comments).toHaveLength(1);
      expect(comments[0].aweme_id).toBe('7384958671234567890');
      expect(comments[0].keyword).toBe('AI 客服');
      expect(comments[0].text).toBe('');  // search 路径无评论
      expect(comments[0].user.nickname).toBe('小张');
    });

    it('空数组 → 空数组', () => {
      expect(normalizeSearchResults([], 'kw')).toHaveLength(0);
    });
  });

  describe('normalizeUserVideos', () => {
    it('UserVideo[] → Comment[]，top_comments 展开', () => {
      const comments = normalizeUserVideos(mockUserVideos, 'MS4wLjABAAAAxxx');
      expect(comments).toHaveLength(2);
      expect(comments[0].cid).toBe('c1');
      expect(comments[0].text).toBe('求推荐好用的 AI 客服');
      expect(comments[0].keyword).toBe('MS4wLjABAAAAxxx');
      expect(comments[1].cid).toBe('c2');
    });

    it('无 top_comments 的视频 → 跳过', () => {
      const videos: UserVideo[] = [{ index: 1, aweme_id: '1', title: 't', duration: 10, digg_count: 100, play_url: 'p', top_comments: [] }];
      expect(normalizeUserVideos(videos, 'uid')).toHaveLength(0);
    });

    it('create_time 从 Unix timestamp 转为 ISO 8601', () => {
      const comments = normalizeUserVideos(mockUserVideos, 'uid');
      expect(comments[0].create_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('deduplicateComments', () => {
    it('相同 (cid, aweme_id) 只保留第一条', () => {
      const dup: Comment[] = [
        { cid: 'c1', aweme_id: 'a1', video_url: '', video_desc: '', keyword: '', text: 't', user: { nickname: '', uid: '', follower_count: 0, signature: '' }, digg_count: 0, create_time: '', reply_count: 0 },
        { cid: 'c1', aweme_id: 'a1', video_url: '', video_desc: '', keyword: '', text: 't2', user: { nickname: '', uid: '', follower_count: 0, signature: '' }, digg_count: 0, create_time: '', reply_count: 0 },
        { cid: 'c2', aweme_id: 'a1', video_url: '', video_desc: '', keyword: '', text: 't3', user: { nickname: '', uid: '', follower_count: 0, signature: '' }, digg_count: 0, create_time: '', reply_count: 0 },
      ];
      const deduped = deduplicateComments(dup);
      expect(deduped).toHaveLength(2);
    });

    it('空数组 → 空数组', () => {
      expect(deduplicateComments([])).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// filters.ts 测试
// ---------------------------------------------------------------------------

describe('comment-fetch/filters', () => {
  const makeComment = (text: string, nickname = 'nick'): Comment => ({
    cid: 'c1', aweme_id: 'a1', video_url: '', video_desc: '', keyword: '', text, user: { nickname, uid: '', follower_count: 0, signature: '' }, digg_count: 0, create_time: '', reply_count: 0,
  });

  it('min_length: 过滤短评论', () => {
    const comments = [makeComment('hi'), makeComment('hello world')];
    const result = applyCommentFilters(comments, { min_length: 5 });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('hello world');
  });

  it('exclude_emoji_only: 过滤纯 emoji', () => {
    const comments = [makeComment('👍👍👍'), makeComment('你好吗？')];
    const result = applyCommentFilters(comments, { exclude_emoji_only: true });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('你好吗？');
  });

  it('exclude_punctuation_only: 过滤纯 ASCII 标点', () => {
    // 用纯 ASCII 标点（正则 [\w一-鿿] 不覆盖 ! 等 ASCII 标点字符）
    const comments = [
      makeComment('!!!'),        // 纯 ASCII 标点 → 应被过滤
      makeComment('Test 123'),   // 有字母数字 → 保留
    ];
    const result = applyCommentFilters(comments, { exclude_punctuation_only: true });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Test 123');
  });

  it('exclude_marketing: 过滤营销号 nickname', () => {
    const comments = [
      makeComment('这是营销号发的广告内容', '加微私信'),
      makeComment('这是正常用户的问题', '正常用户'),
    ];
    const result = applyCommentFilters(comments, { exclude_marketing: true });
    expect(result).toHaveLength(1);
    expect(result[0].user.nickname).toBe('正常用户');
  });

  it('全部禁用 → 不过滤', () => {
    const comments = [makeComment('👍'), makeComment('...')];
    const result = applyCommentFilters(comments, { exclude_emoji_only: false, exclude_punctuation_only: false, exclude_marketing: false });
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// sources.ts 测试（调度逻辑）
// ---------------------------------------------------------------------------

describe('comment-fetch/sources', () => {
  it('source.mode = sec_uid 时调用 getUserVideos', async () => {
    const { fetchComments } = await import('../../src/modules/comment-fetch/sources.js');

    let calledWith = '';
    const mockCh = new DouyinChannel({
      shellExec: async (cmd, args) => {
        if (args.includes('user-videos')) calledWith = 'user-videos';
        return JSON.stringify([]);
      },
    });

    const config: ChannelsConfig = {
      source: { mode: 'sec_uid' },
      target_sec_uids: { sec_uids: ['MS4wLjABAAAAxxx'], user_videos_limit: 20, comment_limit: 10 },
    };

    await fetchComments(mockCh as any, config);
    expect(calledWith).toBe('user-videos');
  });
});