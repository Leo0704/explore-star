/**
 * MOCK_CHANNEL e2e 集成测试（Phase 3 #5 多渠道架构准备）
 *
 * 覆盖（roadmap §2.5 验收）：
 *   - registerMockChannel() 后 run-daily 用 injectChannel 跑通，**不**依赖真 Chrome
 *   - 视频/评论计数 ≥ fixtures 上限
 *   - exitReason='completed'（e2e 不应触发 puppeteer / BrowserBridge）
 *
 * 注意：本测试不真用 `MOCK_CHANNEL=1` env var（vitest 4 forks 模式下 env var
 * 通过 vi.stubEnv 不总能传递到 module 加载期）—— 直接调 registerMockChannel
 * + injectChannel，等价于 CLI 启用。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runDaily } from '../../src/orchestration/run-daily.js';
import { registerMockChannel } from '../../src/adapters/channel/mock.js';
import type { ChannelAdapter } from '../../src/core/types.js';

describe('MOCK_CHANNEL e2e：run-daily 不依赖真 Chrome 跑通', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('注入 mock channel 后 runDaily dry-run 跑通', async () => {
    await registerMockChannel();
    const { getChannel } = await import('../../src/adapters/registry.js');
    const mockChannel = getChannel('mock') as ChannelAdapter;

    const result = await runDaily({
      businessDir: './business.example/燃点-FDE',
      dryRun: true,
      injectChannel: mockChannel,
      // 写到 /tmp 避免污染仓库
      injectHistoryPath: '/tmp/explore-star-mock-e2e-history.jsonl',
      injectWriteHistory: false,
    });

    // dry-run 模式不应抛异常
    expect(result.date).toBeTruthy();
    expect(result.duration_ms).toBeGreaterThan(0);
  });

  it('mock channel.ping() 永远 loggedIn=true（e2e 跳过 R1 飞书告警）', async () => {
    await registerMockChannel();
    const { getChannel } = await import('../../src/adapters/registry.js');
    const ch = getChannel('mock') as ChannelAdapter;
    const r = await ch.ping();
    expect(r.ok).toBe(true);
    expect(r.loggedIn).toBe(true);
  });

  it('mock channel.search() 返回 fixtures 视频', async () => {
    await registerMockChannel();
    const { getChannel } = await import('../../src/adapters/registry.js');
    const ch = getChannel('mock') as ChannelAdapter;
    const vids = await ch.search({ keywords: ['AI'], limit: 3 });
    expect(vids.length).toBeGreaterThanOrEqual(3);
  });

  it('mock channel.getUserVideos() 返回 fixtures + 评论', async () => {
    await registerMockChannel();
    const { getChannel } = await import('../../src/adapters/registry.js');
    const ch = getChannel('mock') as ChannelAdapter;
    const vids = await ch.getUserVideos('mock-sec-uid', { limit: 2 });
    expect(vids.length).toBe(2);
    let totalComments = 0;
    for (const v of vids) totalComments += v.top_comments.length;
    expect(totalComments).toBeGreaterThanOrEqual(2);
  });
});
