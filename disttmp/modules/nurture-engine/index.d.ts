/**
 * 引导引擎（§3.6）
 *
 * 状态机 + 互动感知 + 智能放弃判定 + 再激活
 *
 * 状态机：
 *   新发现 → 已关注 → 已互动 → 已加好友 → 已加微 → 已预约 → 已成交
 *                                  ↘ 已流失 / 沉默 / 已再激活
 */
import type { Lead, Task, BusinessProfile, ConversionConfig } from '../../core/types.js';
export interface NurtureEngineOptions {
    profile: BusinessProfile;
    conversion: ConversionConfig;
    /** 每天最多生成多少任务（默认 20） */
    dailyTaskLimit?: number;
    /** 同一客户两次任务间隔（小时，默认 24） */
    minIntervalHours?: number;
    /** 同一客户 0 回应上限（默认 3 → 标记流失） */
    noResponseLimit?: number;
    /** 沉默天数（默认 30） */
    dormantDays?: number;
}
export declare function generateDailyTasks(leads: Lead[], opts: NurtureEngineOptions): Task[];
export declare function findReactivatableLeads(leads: Lead[], dormantDays?: number): Lead[];
export declare function reactivate(lead: Lead): Task;
export declare function runCLI(args: string[]): Promise<void>;
