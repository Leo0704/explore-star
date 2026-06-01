/**
 * 安全模块（§3.6.5）
 *
 * 读取 config/safety.json + EMERGENCY_STOP 开关检测
 */
import type { SafetyConfig } from './index.js';
/**
 * 加载安全配置
 */
export declare function loadSafetyConfig(configPath?: string): SafetyConfig;
/**
 * 默认安全配置（fallback）
 */
export declare function getDefaultSafetyConfig(): SafetyConfig;
/**
 * 检查紧急停止开关
 */
export declare function isEmergencyStop(config: SafetyConfig): boolean;
/**
 * 紧急停止则抛错
 */
export declare function throwIfEmergencyStop(config: SafetyConfig): void;
/**
 * 检查是否为致命信号
 */
export declare function isFatalSignal(signalType: string, config: SafetyConfig): boolean;
/**
 * 创建风控信号
 */
export type RiskSignalType = 'slider' | 'rate_limit' | 'ip_switch' | 'account_ban' | 'captcha';
export interface RiskSignal {
    type: RiskSignalType;
    count: number;
    action: 'pause_1h' | 'stop_today' | 'emergency_stop';
}
export declare function createRiskSignal(type: RiskSignalType): RiskSignal;
