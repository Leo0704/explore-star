/**
 * 转化引擎（§3.10）
 *
 * V1.4 实现：
 *   - onLeadAddedWechat: 加微后 24h 内推送物料
 *   - watchBookings: 监听预约事件
 *   - generateDailyReport: 转化日报
 *   - findDormantLeads: 找沉默客户
 *   - reactivateLead: 再激活话术生成+推送
 *   - recordTouchpoint: 触达事件记录
 */
import type { Lead, ConversionConfig, ConversionReport, BusinessProfile, CRMAdapter, TouchpointEvent } from '../../core/types.js';
export interface ConversionEngineOptions {
    profile: BusinessProfile;
    conversion: ConversionConfig;
    crm: CRMAdapter;
    eventsRecorder?: (event: any) => Promise<void>;
    postAddDelayHours?: number;
}
export interface ConversionEngine {
    onLeadAddedWechat(cid: string): Promise<{
        pushed: boolean;
        reason?: string;
    }>;
    watchBookings(): Promise<void>;
    generateDailyReport(date: string): Promise<ConversionReport>;
    findDormantLeads(): Promise<Lead[]>;
    reactivateLead(cid: string): Promise<{
        success: boolean;
        reason: string;
    }>;
    recordTouchpoint(cid: string, touchpoint: TouchpointEvent): Promise<void>;
}
/**
 * 创建转化引擎实例
 */
export declare function createConversionEngine(opts: ConversionEngineOptions): ConversionEngine;
export { pushMaterial, generateConversionReport, pushConversionReport } from './material-pusher.js';
export { watchBookings, syncBookingsOnce } from './booking-listener.js';
export { findDormantLeads, dormantSummary } from './dormant-finder.js';
export { reactivateLead as reactivateLead, reactivateDormantPool } from './reactivate.js';
export declare function handleWechatAdded(lead: Lead, opts: ConversionEngineOptions): Promise<{
    pushed: boolean;
    reason?: string;
}>;
export declare function generateDailyReport(date: string, opts: ConversionEngineOptions): Promise<ConversionReport>;
export declare function pushDailyReport(report: ConversionReport, notifierName?: string): Promise<void>;
export declare function runCLI(args: string[]): Promise<void>;
