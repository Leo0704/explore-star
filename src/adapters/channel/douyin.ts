/**
 * 抖音 Channel Adapter
 *
 * V2：内置 CDP 浏览器操作层（douyin-browser.ts），不再依赖外部 opencli CLI。
 */

import type {
  ChannelAdapter, Video, UserVideo, SearchQuery, RateLimits,
} from '../../core/types.js';
import type { VideoComment } from './douyin-browser.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'douyin' });

export class DouyinChannel implements ChannelAdapter {
  readonly name = 'douyin';
  readonly rateLimits: RateLimits = {
    search_per_hour: 10,
    user_videos_per_hour: 30,
    comment_per_hour: 60,
    friend_request_per_day: 5,
    dm_per_day: 10,
  };

  async search(query: SearchQuery): Promise<Video[]> {
    if (!query.keywords || query.keywords.length === 0) {
      throw new Error('Douyin search 需要至少 1 个关键词');
    }
    const { searchVideos } = await import('./douyin-browser.js');
    const all: Video[] = [];
    for (const kw of query.keywords) {
      try {
        const results = await searchVideos(kw, Math.min(query.limit, 30));
        all.push(...results.map(r => ({
          rank: r.rank, desc: r.desc, author: r.author, url: r.url,
          plays: 0, likes: r.likes, comments: 0, shares: 0, aweme_id: r.aweme_id,
        })));
      } catch (e) {
        log.warn({ err: e, keyword: kw }, '搜索失败');
      }
    }
    return all;
  }

  async getUserVideos(secUid: string, opts: { limit?: number; withComments?: boolean; commentLimit?: number } = {}): Promise<UserVideo[]> {
    if (!secUid) throw new Error('Douyin getUserVideos 需要 sec_uid');
    const { getUserVideosFromBrowser, getVideoComments } = await import('./douyin-browser.js');
    const limit = Math.min(opts.limit ?? 20, 20);
    const videos = await getUserVideosFromBrowser(secUid, limit);
    if (opts.withComments !== false) {
      const commentLimit = Math.min(opts.commentLimit ?? 10, 10);
      for (const video of videos) {
        try {
          const comments = await getVideoComments(video.aweme_id, commentLimit);
          video.top_comments = comments.map(c => ({
            cid: `${video.aweme_id}-${c.nickname}`, text: c.text,
            user: { nickname: c.nickname, uid: c.uid, follower_count: 0, signature: '' },
            digg_count: c.digg_count, create_time: 0, reply_count: 0,
          }));
        } catch { video.top_comments = []; }
      }
    }
    return videos;
  }

  async getVideoComments(awemeId: string, count = 10): Promise<VideoComment[]> {
    const { getVideoComments: fetch } = await import('./douyin-browser.js');
    return fetch(awemeId, count);
  }

  async ping(): Promise<{ ok: boolean; loggedIn: boolean }> {
    try {
      const { checkLogin } = await import('./douyin-browser.js');
      const r = await checkLogin();
      return { ok: true, loggedIn: r.loggedIn };
    } catch { return { ok: false, loggedIn: false }; }
  }
}

export async function registerDouyinChannel(): Promise<void> {
  const { registerChannel } = await import('../registry.js');
  registerChannel('douyin', new DouyinChannel());
}
