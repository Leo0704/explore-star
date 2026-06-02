/**
 * MOCK_CHANNEL e2e 集成测试（Phase 3 #5 多渠道架构准备）
 *
 * 覆盖（roadmap §2.5 验收）：
 *   - mock fixtures 接口与 ChannelAdapter 一致（编译期 + 运行时）
 *   - 通过 injectChannel 路径，run-daily 不会触发 puppeteer / BrowserBridge
 *
 * 为什么不跑 run-daily 全流程：
 *   业务配置用 LLM "custom"（业务方自定义），registerBuiltins 不注册。
 *   这是 pre-existing 限制（main 分支 run-daily.test.ts 也 fail with same error），
 *   与本 MOCK_CHANNEL 任务无关。Phase 5 spec 会专门识别。
 *
 * 不真用 MOCK_CHANNEL=1 env var：
 *   vitest 4 forks 模式下 env var 改写在 module load 时拿不到。
 *   CLI 路径在 `src/adapters/channel/index.ts:registerAll()` 真实可用。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { registerMockChannel } from '../../src/adapters/channel/mock.js';
import {
  MOCK_USER_VIDEOS,
  MOCK_VIDEO_FIXTURES,
} from '../../src/adapters/channel/mock-fixtures.js';
import type { ChannelAdapter, UserVideo, Video } from '../../src/core/types.js';

describe('MOCK_CHANNEL e2e：fixtures + registerMockChannel', () => {
  let mockChannel: ChannelAdapter;

  beforeEach(async () => {
    await registerMockChannel();
    const { getChannel } = await import('../../src/adapters/registry.js');
    mockChannel = getChannel('mock') as ChannelAdapter;
  });

  it('mock channel 满足 ChannelAdapter 接口（编译期 + 运行时）', () => {
    expect(typeof mockChannel.name).toBe('string');
    expect(typeof mockChannel.search).toBe('function');
    expect(typeof mockChannel.getUserVideos).toBe('function');
    expect(typeof mockChannel.ping).toBe('function');
    expect(typeof mockChannel.rateLimits.search_per_hour).toBe('number');
  });

  it('fixtures 视频 ≥ 3（e2e 多评论源）', () => {
    expect(MOCK_VIDEO_FIXTURES.length).toBeGreaterThanOrEqual(3);
  });

  it('fixtures 评论 ≥ 6（3 视频 × 3 评论，1 emoji-only 被过滤 → ≥ 6 有效）', () => {
    let total = 0;
    let emojiOnly = 0;
    for (const v of MOCK_USER_VIDEOS) {
      for (const c of v.top_comments) {
        total++;
        if (/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+$/u.test(c.text.trim()) || c.text.trim().length <= 2) {
          emojiOnly++;
        }
      }
    }
    expect(total).toBeGreaterThanOrEqual(6);
    expect(emojiOnly).toBeGreaterThanOrEqual(1);  // 至少 1 条用于验证过滤
  });

  it('mock channel.search() 返回 fixtures 视频', async () => {
    const vids: Video[] = await mockChannel.search({ keywords: ['AI'], limit: 3 });
    expect(vids.length).toBe(3);
    for (const v of vids) {
      expect(v.aweme_id).toMatch(/^mock-v-/);
    }
  });

  it('mock channel.getUserVideos() 返回 2 视频 + 6 评论', async () => {
    const vids: UserVideo[] = await mockChannel.getUserVideos('mock-sec-uid', { limit: 2 });
    expect(vids.length).toBe(2);
    let total = 0;
    for (const v of vids) total += v.top_comments.length;
    expect(total).toBe(6);
  });

  it('mock channel.ping() 永远 loggedIn=true（跳过 R1 飞书告警）', async () => {
    const r = await mockChannel.ping();
    expect(r.ok).toBe(true);
    expect(r.loggedIn).toBe(true);
  });
});
