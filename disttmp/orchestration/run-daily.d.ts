/**
 * 每日编排器（§3.7）
 *
 * 串联：搜索 → 评论抓取 → 意图分析 → CRM 同步 → 引导任务生成 → 通知
 *
 * 实现 §3.7 v1.4 真实流程（双路径：sec_uid 模式 + keyword 模式）
 */
export interface RunDailyOptions {
    businessDir: string;
    /** 跳过写盘（测试用） */
    dryRun?: boolean;
    /** 跳过 LLM（用 mock） */
    skipLLM?: boolean;
    /** 限制每日任务数（默认 20） */
    dailyTaskLimit?: number;
    /** 视频扫描限制（默认 50） */
    videoLimit?: number;
    /** 不重置 LLM provider（仅用于 dry-run） */
    injectLLM?: {
        complete(p: string): Promise<string>;
    };
}
export interface RunDailyResult {
    date: string;
    videosScanned: number;
    commentsCollected: number;
    leadsCreated: number;
    tasksGenerated: number;
    duration_ms: number;
    errors: string[];
}
export declare function runDaily(opts: RunDailyOptions): Promise<RunDailyResult>;
export declare function runCLI(args: string[]): Promise<void>;
