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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
// ---------------------------------------------------------------------------
// Adapter 主类
// ---------------------------------------------------------------------------
export class DouyinChannel {
    name = 'douyin';
    rateLimits = {
        search_per_hour: 10,
        user_videos_per_hour: 30,
        comment_per_hour: 60,
        friend_request_per_day: 5,
        dm_per_day: 10,
    };
    options;
    shellExec;
    constructor(opts = {}) {
        this.options = {
            opencliPath: opts.opencliPath || 'opencli',
            timeoutMs: opts.timeoutMs ?? 60_000,
        };
        this.shellExec = opts.shellExec ?? this.defaultShellExec.bind(this);
    }
    /**
     * 按关键词搜视频
     *
     * **重要**：opencli 搜索结果**不包含评论数**（plays/comments/shares = 0）。
     * 如需评论，请用 `getUserVideos(sec_uid, { withComments: true })`。
     */
    async search(query) {
        if (!query.keywords || query.keywords.length === 0) {
            throw new Error('Douyin search 需要至少 1 个关键词');
        }
        // opencli 一次只接 1 个 query；多关键词时循环
        const all = [];
        for (const kw of query.keywords) {
            try {
                const videos = await this.callSearch(kw, Math.min(query.limit, 30));
                all.push(...videos);
            }
            catch (e) {
                if (this.isDouyinError(e) && e.code === 'EMPTY_RESULT')
                    continue; // 单关键词空结果不算错
                throw e;
            }
        }
        return all;
    }
    /**
     * 拉取指定 KOL 的视频列表 + 评论
     *
     * **V1.4 主路径**：用 `user-videos --with_comments` 一次性拿视频+评论。
     * 单次最多 20 视频 × 10 评论 = 200 条评论。
     */
    async getUserVideos(secUid, opts = {}) {
        if (!secUid)
            throw new Error('Douyin getUserVideos 需要 sec_uid');
        const limit = Math.min(opts.limit ?? 20, 20);
        const withComments = opts.withComments !== false;
        const commentLimit = Math.min(opts.commentLimit ?? 10, 10);
        const args = [
            'douyin', 'user-videos', secUid,
            '--limit', String(limit),
            '--with_comments', String(withComments),
            '--comment_limit', String(commentLimit),
            '--format', 'json',
        ];
        try {
            const stdout = await this.shellExec(this.options.opencliPath, args);
            const data = JSON.parse(stdout);
            if (!Array.isArray(data)) {
                throw new Error('user-videos 返回非数组 JSON：' + stdout.slice(0, 200));
            }
            return data;
        }
        catch (e) {
            throw this.normalizeError(e, 'user-videos');
        }
    }
    /**
     * 健康检查：探测 opencli 是否可用 + Chrome 是否登录
     */
    async ping() {
        try {
            const stdout = await this.shellExec(this.options.opencliPath, [
                'douyin', 'profile', '--format', 'json',
            ]);
            const data = JSON.parse(stdout);
            const loggedIn = !!(data.uid && data.nickname);
            return { ok: true, loggedIn };
        }
        catch {
            return { ok: false, loggedIn: false };
        }
    }
    // -------------------------------------------------------------------------
    // 内部：单次 search 调用
    // -------------------------------------------------------------------------
    async callSearch(keyword, limit) {
        const args = [
            'douyin', 'search', keyword,
            '--limit', String(limit),
            '--format', 'json',
        ];
        try {
            const stdout = await this.shellExec(this.options.opencliPath, args);
            const data = JSON.parse(stdout);
            if (!Array.isArray(data)) {
                throw new Error('search 返回非数组 JSON：' + stdout.slice(0, 200));
            }
            // 提取 aweme_id 从 url（search.js 实际只给 url）
            return data.map((v) => ({
                rank: v.rank,
                desc: v.desc ?? '',
                author: v.author ?? '',
                url: v.url ?? '',
                plays: v.plays ?? 0,
                likes: v.likes ?? 0,
                comments: v.comments ?? 0,
                shares: v.shares ?? 0,
                aweme_id: extractAwemeId(v.url ?? ''),
            }));
        }
        catch (e) {
            throw this.normalizeError(e, 'search');
        }
    }
    // -------------------------------------------------------------------------
    // 内部：默认 shell 执行
    // -------------------------------------------------------------------------
    async defaultShellExec(cmd, args) {
        const { stdout } = await execFileAsync(cmd, args, {
            timeout: this.options.timeoutMs,
            maxBuffer: 50 * 1024 * 1024, // 50MB（视频列表可能很大）
        });
        return stdout;
    }
    // -------------------------------------------------------------------------
    // 内部：错误归一化
    // -------------------------------------------------------------------------
    normalizeError(e, context) {
        // 1. 如果错误已有 code 字段（来自 normalizeError 之前的 pass），直接返回
        if (this.isDouyinError(e)) {
            // 重新包装为更友好的中文消息
            const code = e.code;
            const friendly = {
                AUTH_REQUIRED: '需要登录抖音',
                EMPTY_RESULT: '无结果',
                ARGUMENT: '参数错误',
                COMMAND_EXEC: '执行失败',
            };
            const msg = friendly[code] ?? e.message;
            return Object.assign(new Error(`[douyin ${context}] ${msg}`), { code });
        }
        const message = e instanceof Error ? e.message : String(e);
        // opencli 错误输出格式：{"ok":false,"error":{"code":"...","message":"..."}}
        if (message.includes('AuthRequiredError') || message.includes('verify_check')) {
            return Object.assign(new Error(`[douyin ${context}] 需要登录抖音`), { code: 'AUTH_REQUIRED' });
        }
        if (message.includes('EmptyResultError') || message.includes('No Douyin videos matched')) {
            return Object.assign(new Error(`[douyin ${context}] 无结果`), { code: 'EMPTY_RESULT' });
        }
        if (message.includes('ArgumentError')) {
            return Object.assign(new Error(`[douyin ${context}] 参数错误：${message}`), { code: 'ARGUMENT' });
        }
        if (message.includes('CommandExecutionError') || message.includes('Pre-navigation')) {
            return Object.assign(new Error(`[douyin ${context}] 执行失败：${message}`), { code: 'COMMAND_EXEC' });
        }
        return Object.assign(new Error(`[douyin ${context}] ${message}`), { code: 'UNKNOWN' });
    }
    isDouyinError(e) {
        return e instanceof Error && 'code' in e && typeof e.code === 'string';
    }
}
// ---------------------------------------------------------------------------
// 工具函数：从 url 提取 aweme_id（参考 opencli/clis/douyin/search.js 的实现）
// ---------------------------------------------------------------------------
export function extractAwemeId(href) {
    if (typeof href !== 'string' || !href)
        return '';
    let full = href;
    if (full.startsWith('//'))
        full = 'https:' + full;
    else if (full.startsWith('/'))
        full = 'https://www.douyin.com' + full;
    try {
        const parsed = new URL(full);
        if (!/(^|\.)douyin\.com$/.test(parsed.hostname))
            return '';
        const match = parsed.pathname.match(/^\/video\/(\d+)$/);
        return match?.[1] ?? '';
    }
    catch {
        return '';
    }
}
// ---------------------------------------------------------------------------
// 默认注册
// ---------------------------------------------------------------------------
export function registerDouyinChannel() {
    // 延迟注册避免循环 import
    import('../registry.js').then(({ registerChannel }) => {
        registerChannel('douyin', new DouyinChannel());
    });
}
//# sourceMappingURL=douyin.js.map