/**
 * Channel Adapters 索引
 *
 * Phase 3 #5：MOCK_CHANNEL=1 时同时注册 mock channel（CLI smoke 用）
 */
import { registerDouyinChannel } from './douyin.js';

export async function registerAll(): Promise<void> {
  await registerDouyinChannel();

  // MOCK_CHANNEL=1 → 注册 mock channel（e2e / CLI smoke 用，不依赖真 Chrome）
  if (process.env.MOCK_CHANNEL === '1') {
    const { registerMockChannel } = await import('./mock.js');
    await registerMockChannel();
  }
}

export { DouyinChannel } from './douyin.js';
export { MockChannel } from './mock.js';
