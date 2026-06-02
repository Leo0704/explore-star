/**
 * MOCK_CHANNEL（Phase 3 #5 多渠道架构准备）
 *
 * 用途：e2e 测试和本地开发用，**不依赖真 puppeteer / Chrome**。
 * 启用：MOCK_CHANNEL=1（CLI 注入）/ injectChannel（测试注入）
 *
 * 设计原则：
 *   - 返回固定 fixtures（mock-fixtures.ts）
 *   - rateLimits 故意比真 douyin 宽松，让 e2e 跑得快
 *   - 永远 loggedIn=true（e2e 跳过 R1 飞书告警）
 */

import type { ChannelAdapter, RateLimits, SearchQuery, UserVideo, Video } from '../../core/types.js';
import { MOCK_USER_VIDEOS, MOCK_VIDEO_FIXTURES } from './mock-fixtures.js';

export class MockChannel implements ChannelAdapter {
  readonly name = 'mock';
  readonly rateLimits: RateLimits = {
    // 比真 douyin 宽松 10x，让 e2e 跑得快
    search_per_hour: 100,
    user_videos_per_hour: 200,
    comment_per_hour: 500,
    friend_request_per_day: 50,
    dm_per_day: 100,
  };

  async search(_query: SearchQuery): Promise<Video[]> {
    // 忽略 query 关键词（mock 是固定的）
    // limit 截断（fixtures 最多 3 条）
    return MOCK_VIDEO_FIXTURES.slice(0, 3);
  }

  async getUserVideos(_secUid: string, opts: { limit?: number; withComments?: boolean; commentLimit?: number } = {}): Promise<UserVideo[]> {
    const limit = Math.min(opts.limit ?? 20, 20);
    return MOCK_USER_VIDEOS.slice(0, limit);
  }

  async ping(): Promise<{ ok: boolean; loggedIn: boolean }> {
    return { ok: true, loggedIn: true };
  }
}

export async function registerMockChannel(): Promise<void> {
  const { registerChannel } = await import('../registry.js');
  registerChannel('mock', new MockChannel());
}
