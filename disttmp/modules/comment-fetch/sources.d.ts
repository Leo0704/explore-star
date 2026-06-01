/**
 * comment-fetch/sources.ts
 *
 * 调度策略：
 *   - source.mode = 'sec_uid'  → 用 getUserVideos（一次拿视频+评论）
 *   - source.mode = 'keyword'  → 用 search（只拿视频 desc+likes，无评论）
 *   - source.mode = 'both'     → 先 sec_uid 再 keyword
 *
 * 暴露统一的 fetchComments(secUids[], config) 接口，
 * 内部组合 DouyinChannel 的 search / getUserVideos。
 */
import type { DouyinChannel } from '../../adapters/channel/douyin.js';
import type { ChannelsConfig } from '../../core/types.js';
import type { Comment } from '../../core/types.js';
/** 从 sec_uid 路径拉评论（V1.4 主路径） */
export declare function fetchFromSecUids(channel: DouyinChannel, secUids: string[], config: ChannelsConfig): Promise<Comment[]>;
/** 从 keyword 路径拉视频（备选路径，评论=0） */
export declare function fetchFromKeywords(channel: DouyinChannel, keywords: string[], config: ChannelsConfig): Promise<Comment[]>;
/**
 * 主入口：按 source.mode 调度两路
 */
export declare function fetchComments(channel: DouyinChannel, config: ChannelsConfig): Promise<Comment[]>;
