/**
 * comment-fetch/index.ts
 *
 * 标准化两路 opencli 输出 → 统一 Comment[] schema
 *
 * 两路来源：
 *   1. search（关键词路径）：Video[]，无评论、无 aweme_id（需从 url 提取）
 *   2. user-videos --with_comments（sec_uid 路径）：UserVideo[]，带 top_comments
 *
 * 输出：
 *   Comment[]（定义见 src/core/types.ts）
 *
 * 设计要点：
 *   - search 路径只有视频 metadata，无评论 → 返回空 Comment[]（下游 LLM 分析会跳过）
 *   - user-videos 路径才有真实评论
 *   - 去重：相同 (cid, aweme_id) 只保留一条
 */
import type { Video, UserVideo, Comment } from '../../core/types.js';
/**
 * search 路径：Video[] → Comment[]
 *
 * 注意：opencli search 结果**不包含评论**（plays/comments/shares = 0）。
 * 这里把视频本身包装成"虚拟 comment"用于记录来源，实际评论为空数组。
 * 下游的 intent-analyzer 会跳过无评论的项。
 */
export declare function normalizeSearchResults(videos: Video[], keyword: string): Comment[];
/**
 * user-videos 路径：UserVideo[] → Comment[]
 *
 * 每个视频的 top_comments 展开为独立 Comment 条目。
 * top_comments 为空时返回空数组（不影响整体）。
 */
export declare function normalizeUserVideos(videos: UserVideo[], secUid: string): Comment[];
/**
 * 按 (cid, aweme_id) 去重，保留第一条
 */
export declare function deduplicateComments(comments: Comment[]): Comment[];
export declare function normalize(videos: Video[], keyword: string): Comment[];
export declare function normalize(videos: UserVideo[], keyword: string): Comment[];
