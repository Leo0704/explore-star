/**
 * 抖音 Channel Adapter
 *
 * 对应文档 §3.1 + §3.2 + §13.4.3
 *
 * 策略：shell out 到 `opencli douyin ... --format json`，解析 stdout。
 *
 * 依赖：
 *   - 本地 opencli 源码：`/Users/lylyyds/Desktop/opencli/`
 *     （`search.js` 在 ≥1.8.0 才有；`user-videos.js` ≥1.7.0）
 *   - Chrome 必须已登录抖音（Strategy.COOKIE）
 *
 * 设计要点：
 *   - V1.4 重点：用 `user-videos --with_comments` 拿视频+评论
 *   - `search` 仅作 fallback（评论=0，需要二次调用）
 *   - 所有调用走 `shellExec()` 包装器 → 单元测试可注入 mock
 */
import type { ChannelAdapter, Video, UserVideo, SearchQuery, RateLimits } from '../../core/types.js';
export interface DouyinChannelOptions {
    /** opencli 可执行文件路径，默认从 $PATH 找 */
    opencliPath?: string;
    /** opencli 全局超时（毫秒） */
    timeoutMs?: number;
    /** 测试时可注入 mock shell exec */
    shellExec?: (cmd: string, args: string[]) => Promise<string>;
}
export interface DouyinError {
    ok: false;
    code: 'AUTH_REQUIRED' | 'EMPTY_RESULT' | 'COMMAND_EXEC' | 'ARGUMENT' | 'UNKNOWN';
    message: string;
}
export declare class DouyinChannel implements ChannelAdapter {
    readonly name = "douyin";
    readonly rateLimits: RateLimits;
    private readonly options;
    private readonly shellExec;
    constructor(opts?: DouyinChannelOptions);
    /**
     * 按关键词搜视频
     *
     * **重要**：opencli 搜索结果**不包含评论数**（plays/comments/shares = 0）。
     * 如需评论，请用 `getUserVideos(sec_uid, { withComments: true })`。
     */
    search(query: SearchQuery): Promise<Video[]>;
    /**
     * 拉取指定 KOL 的视频列表 + 评论
     *
     * **V1.4 主路径**：用 `user-videos --with_comments` 一次性拿视频+评论。
     * 单次最多 20 视频 × 10 评论 = 200 条评论。
     */
    getUserVideos(secUid: string, opts?: {
        limit?: number;
        withComments?: boolean;
        commentLimit?: number;
    }): Promise<UserVideo[]>;
    /**
     * 健康检查：探测 opencli 是否可用 + Chrome 是否登录
     */
    ping(): Promise<{
        ok: boolean;
        loggedIn: boolean;
    }>;
    private callSearch;
    private defaultShellExec;
    private normalizeError;
    private isDouyinError;
}
export declare function extractAwemeId(href: string): string;
export declare function registerDouyinChannel(): void;
