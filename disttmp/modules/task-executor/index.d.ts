/**
 * 任务执行器（§3.6.5）
 *
 * 登录态浏览器 + 限速 + 风控信号 + 紧急停止 + 钩子审核
 *
 * V1 实现：mock 浏览器（不真调），留接口便于后续升级
 */
import type { Task, TaskAction, TaskResult } from '../../core/types.js';
export interface SafetyConfig {
    rate_limits: {
        douyin: {
            search_calls_per_hour: number;
            user_videos_calls_per_hour: number;
            friend_request_per_day: number;
            dm_per_day: number;
        };
        min_interval_seconds: number;
        max_interval_seconds: number;
    };
    daily_budget: {
        videos: number;
        comments_scanned: number;
        leads_created: number;
        engagement_actions: number;
    };
    emergency_stop: string;
    fatal_signals: string[];
    hook_review?: boolean;
}
export interface RiskSignal {
    type: 'slider' | 'rate_limit' | 'ip_switch' | 'account_ban' | 'captcha';
    count: number;
    action: 'pause_1h' | 'stop_today' | 'emergency_stop';
}
export interface ExecutionResult {
    task_id: string;
    lead_cid: string;
    action: TaskAction;
    result: TaskResult;
    executed_at: string;
    response_text?: string;
    risk_signal?: RiskSignal;
    error_message?: string;
}
export declare function loadSafetyConfig(configPath?: string): SafetyConfig;
export declare function isEmergencyStop(config: SafetyConfig): boolean;
export declare function throwIfEmergencyStop(config: SafetyConfig): void;
interface RateLimitCounters {
    friend_requests_today: number;
    dm_today: number;
    last_action_ms: number;
}
export declare function createRateLimiter(): {
    canFriendRequest(config: SafetyConfig): boolean;
    canDm(config: SafetyConfig): boolean;
    recordFriendRequest(): void;
    recordDm(): void;
    /** 随机间隔（3-8 秒真人节律） */
    randomInterval(config: SafetyConfig): number;
    /** 等待随机间隔（真人节律） */
    waitForInterval(config: SafetyConfig): Promise<void>;
    /** 重置每日计数（供编排器在每天开始时调用） */
    resetDaily(): void;
    getCounters(): Readonly<RateLimitCounters>;
};
export interface HookReviewResult {
    approved: boolean;
    modified_hook?: string;
    reason?: string;
}
/**
 * 钩子审核模式：将任务写入飞书/微信等多维表，人工标记后再执行
 * V1 实现：直接批准（mock），留接口
 */
export declare function reviewHook(task: Task, reviewConfig: boolean): Promise<HookReviewResult>;
export interface BrowserExecuteOptions {
    chromeProfile?: string;
    headless?: boolean;
}
/**
 * 通过登录态浏览器执行单个任务
 * V1 实现：mock 返回成功，不真调浏览器
 */
export declare function browserExecute(task: Task, _opts?: BrowserExecuteOptions): Promise<ExecutionResult>;
export declare function executeTasks(tasks: Task[], config: SafetyConfig, opts?: BrowserExecuteOptions): Promise<ExecutionResult[]>;
export declare function createRiskSignal(type: RiskSignal['type'], config: SafetyConfig): RiskSignal;
export declare function runCLI(args: string[]): Promise<void>;
export {};
