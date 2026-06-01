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
import { extractAwemeId } from '../../adapters/channel/douyin.js';
// ---------------------------------------------------------------------------
// 标准化：search 路径（Video → Comment[]，无评论）
// ---------------------------------------------------------------------------
/**
 * search 路径：Video[] → Comment[]
 *
 * 注意：opencli search 结果**不包含评论**（plays/comments/shares = 0）。
 * 这里把视频本身包装成"虚拟 comment"用于记录来源，实际评论为空数组。
 * 下游的 intent-analyzer 会跳过无评论的项。
 */
export function normalizeSearchResults(videos, keyword) {
    return videos.map((v, idx) => {
        const awemeId = v.aweme_id ?? extractAwemeId(v.url);
        return {
            cid: `search-${awemeId}-${idx}`,
            aweme_id: awemeId,
            video_url: v.url,
            video_desc: v.desc,
            keyword,
            text: '', // search 路径无评论
            user: {
                nickname: v.author,
                uid: '',
                follower_count: 0,
                signature: '',
            },
            digg_count: 0,
            create_time: '', // search 路径无 create_time
            reply_count: 0,
        };
    });
}
// ---------------------------------------------------------------------------
// 标准化：user-videos 路径（UserVideo[] → Comment[]）
// ---------------------------------------------------------------------------
/**
 * user-videos 路径：UserVideo[] → Comment[]
 *
 * 每个视频的 top_comments 展开为独立 Comment 条目。
 * top_comments 为空时返回空数组（不影响整体）。
 */
export function normalizeUserVideos(videos, secUid) {
    const result = [];
    for (const video of videos) {
        if (!video.top_comments || video.top_comments.length === 0) {
            continue;
        }
        for (const c of video.top_comments) {
            result.push({
                cid: c.cid,
                aweme_id: video.aweme_id,
                video_url: `https://www.douyin.com/video/${video.aweme_id}`,
                video_desc: video.title,
                keyword: secUid,
                text: c.text,
                user: {
                    nickname: c.user.nickname,
                    uid: c.user.uid,
                    follower_count: c.user.follower_count,
                    signature: c.user.signature,
                },
                digg_count: c.digg_count,
                create_time: new Date(c.create_time * 1000).toISOString(), // Unix timestamp → ISO 8601
                reply_count: c.reply_count,
            });
        }
    }
    return result;
}
// ---------------------------------------------------------------------------
// 去重
// ---------------------------------------------------------------------------
/**
 * 按 (cid, aweme_id) 去重，保留第一条
 */
export function deduplicateComments(comments) {
    const seen = new Set();
    return comments.filter(c => {
        const key = `${c.cid}:${c.aweme_id}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
export function normalize(videos, keyword) {
    if (isUserVideos(videos)) {
        return deduplicateComments(normalizeUserVideos(videos, keyword));
    }
    return deduplicateComments(normalizeSearchResults(videos, keyword));
}
function isUserVideos(v) {
    return v.length > 0 && 'top_comments' in v[0];
}
//# sourceMappingURL=index.js.map