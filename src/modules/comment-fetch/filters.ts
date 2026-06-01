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

// ---------------------------------------------------------------------------
// Emoji 检测（基于 Unicode 区块）
// ---------------------------------------------------------------------------

// emoji unicode ranges
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/u;

function isEmojiOnly(text: string): boolean {
  // 去除 emoji 后是否为空
  const withoutEmoji = text.replace(EMOJI_REGEX, '').trim();
  return withoutEmoji.length === 0;
}

// ---------------------------------------------------------------------------
// 纯标点检测
// ---------------------------------------------------------------------------

// 思路：保留文字类字符（字母/数字/中文），看剩下的内容
// 如果只剩标点/空格/whitespace，则认为是"纯标点"
const WORD_CHAR_REGEX = /[a-zA-Z0-9一-鿿]+/g;

function isPunctuationOnly(text: string): boolean {
  const wordChars = text.match(WORD_CHAR_REGEX);
  // 如果没有任何文字类字符，就认为是纯标点
  return wordChars === null || wordChars.length === 0;
}

// ---------------------------------------------------------------------------
// 营销号检测（简化版：nickname 含关键词）
// ---------------------------------------------------------------------------

const MARKETING_KEYWORDS = ['加微', '私聊', '看主页', '找我', '代发', '引流'];

function isMarketingAccount(nickname: string): boolean {
  return MARKETING_KEYWORDS.some(kw => nickname.includes(kw));
}

// ---------------------------------------------------------------------------
// 评论过滤器
// ---------------------------------------------------------------------------

export interface CommentFilterOptions {
  min_length?: number;
  exclude_emoji_only?: boolean;
  exclude_punctuation_only?: boolean;
  exclude_marketing?: boolean;
}

export function applyCommentFilters(
  comments: Comment[],
  opts: CommentFilterOptions,
): Comment[] {
  return comments.filter(c => {
    // min_length
    if (opts.min_length != null && c.text.length < opts.min_length) {
      return false;
    }

    // exclude_emoji_only
    if (opts.exclude_emoji_only !== false && isEmojiOnly(c.text)) {
      return false;
    }

    // exclude_punctuation_only
    if (opts.exclude_punctuation_only !== false && isPunctuationOnly(c.text)) {
      return false;
    }

    // exclude_marketing（简化版：只看 nickname）
    if (opts.exclude_marketing !== false && isMarketingAccount(c.user.nickname)) {
      return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// 视频过滤器（用于 search 结果）
// ---------------------------------------------------------------------------

export interface VideoFilterOptions {
  min_likes?: number;
  max_age_days?: number;
}

function isVideoTooOld(createTime: string, maxAgeDays: number): boolean {
  const ageMs = Date.now() - new Date(createTime).getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return ageMs > maxAgeMs;
}

export function applyVideoFilters(videos: Video[], opts: VideoFilterOptions): Video[] {
  return videos.filter(v => {
    if (opts.min_likes != null && v.likes < opts.min_likes) {
      return false;
    }
    // search 结果没有 create_time，降级为只用 min_likes 过滤
    return true;
  });
}

// ---------------------------------------------------------------------------
// 组合过滤（channels.yaml filters + comment_filters）
// ---------------------------------------------------------------------------

export function filterComments(comments: Comment[], config: ChannelsConfig): Comment[] {
  const commentOpts: CommentFilterOptions = {
    min_length: config.comment_filters?.min_length ?? 4,
    exclude_emoji_only: config.comment_filters?.exclude_emoji_only ?? true,
    exclude_punctuation_only: config.comment_filters?.exclude_punctuation_only ?? true,
    exclude_marketing: config.comment_filters?.exclude_marketing ?? true,
  };
  return applyCommentFilters(comments, commentOpts);
}