/**
 * comment-fetch/filters.ts
 *
 * 实现 channels.yaml 中的 comment_filters：
 *   - min_length
 *   - exclude_emoji_only
 *   - exclude_punctuation_only
 *   - exclude_marketing（简化版：nickname 含关键词）
 *
 * 以及 video filters（applyVideoFilters）：
 *   - min_likes
 *   - max_age_days
 */
import type { Comment, Video, ChannelsConfig } from '../../core/types.js';
export interface CommentFilterOptions {
    min_length?: number;
    exclude_emoji_only?: boolean;
    exclude_punctuation_only?: boolean;
    exclude_marketing?: boolean;
}
export declare function applyCommentFilters(comments: Comment[], opts: CommentFilterOptions): Comment[];
export interface VideoFilterOptions {
    min_likes?: number;
    max_age_days?: number;
}
export declare function applyVideoFilters(videos: Video[], opts: VideoFilterOptions): Video[];
export declare function filterComments(comments: Comment[], config: ChannelsConfig): Comment[];
