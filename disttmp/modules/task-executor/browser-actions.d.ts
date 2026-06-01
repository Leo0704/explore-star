/**
 * 浏览器动作映射（§3.6.5）
 *
 * like/comment/friend/dm 四种 action 映射到浏览器操作
 */
import type { Task, ExecutionResult } from './index.js';
export type BrowserActionType = 'like' | 'follow' | 'comment' | 'friend_request' | 'dm' | 'send_material';
/**
 * TaskAction → BrowserActionType 映射
 */
export declare function mapActionToBrowser(task: Task): BrowserActionType;
/**
 * 执行浏览器动作（V1 mock）
 * 真实实现需要 puppeteer 或 opencli browser skill
 */
export declare function executeBrowserAction(task: Task, chromeProfile?: string): Promise<ExecutionResult>;
/**
 * 解析视频 URL 获取 aweme_id
 */
export declare function extractAwemeId(videoUrl: string): string;
/**
 * 构造用户主页 URL
 */
export declare function buildUserProfileUrl(userUid: string): string;
