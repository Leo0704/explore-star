/**
 * Channel Adapters 索引
 */
import { registerDouyinChannel } from './douyin.js';

export function registerAll(): void {
  registerDouyinChannel();
}

export { DouyinChannel, extractAwemeId } from './douyin.js';
export type { DouyinChannelOptions } from './douyin.js';
