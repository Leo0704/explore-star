/**
 * Channel Adapters 索引
 */
import { registerDouyinChannel } from './douyin.js';
export function registerAll() {
    registerDouyinChannel();
}
export { DouyinChannel, extractAwemeId } from './douyin.js';
//# sourceMappingURL=index.js.map