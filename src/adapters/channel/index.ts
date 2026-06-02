/**
 * Channel Adapters 索引
 */
import { registerDouyinChannel } from './douyin.js';

export async function registerAll(): Promise<void> {
  await registerDouyinChannel();
}

export { DouyinChannel } from './douyin.js';
