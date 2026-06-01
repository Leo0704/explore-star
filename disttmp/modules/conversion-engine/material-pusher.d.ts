/**
 * 物料推送器（§3.10 加微后 24h 内推送 + 转化日报 + ROI）
 *
 * V1.4 实现：
 *   - 加微后 24h 内推送 post_add_asset（PDF / link / image）
 *   - 转化日报生成（每天 22:00）
 *   - ROI 计算
 */
import type { Lead, ConversionConfig, ConversionReport, BusinessProfile, CRMAdapter } from '../../core/types.js';
export interface MaterialPusherOptions {
    profile: BusinessProfile;
    conversion: ConversionConfig;
    crm: CRMAdapter;
    /** 加微后延迟推送时长（小时，默认 24） */
    postAddDelayHours?: number;
}
export declare function pushMaterial(lead: Lead, opts: MaterialPusherOptions): Promise<{
    pushed: boolean;
    reason?: string;
}>;
export declare function generateConversionReport(date: string, opts: MaterialPusherOptions): Promise<ConversionReport>;
export declare function pushConversionReport(report: ConversionReport): Promise<void>;
