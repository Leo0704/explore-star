/**
 * 健康检查（§5.4 4 类告警）
 *
 * V1.4 实现：
 *   - checkSystemHealth: 系统基本状态（磁盘/cron/日志）
 *   - checkAdapterHealth: 各 adapter 连通性（LLM/CRM/Channel/Notifier）
 *   - checkSafetyLimits: 今日限速状态（任务数/好友数/私信数）
 *   - checkEmergencyStop: 紧急停止开关
 */
export type HealthStatus = 'ok' | 'warning' | 'critical' | 'error';
export interface HealthCheckResult {
    status: HealthStatus;
    checks: Array<{
        name: string;
        status: HealthStatus;
        message: string;
        details?: Record<string, unknown>;
    }>;
    summary: string;
}
/**
 * 全面健康检查
 */
export declare function checkAll(businessDir?: string): Promise<HealthCheckResult>;
/**
 * §5.4.1 系统基本状态（磁盘/cron/日志）
 */
export declare function checkSystemHealth(): Promise<HealthCheckResult>;
/**
 * §5.4.2 各 adapter 连通性
 */
export declare function checkAdapterHealth(): Promise<HealthCheckResult>;
/**
 * §5.4.3 今日限速状态
 */
export declare function checkSafetyLimits(businessDir?: string): Promise<HealthCheckResult>;
/**
 * §5.4.4 紧急停止开关
 */
export declare function checkEmergencyStop(): Promise<HealthCheckResult>;
export declare function formatHealthReport(result: HealthCheckResult): string;
