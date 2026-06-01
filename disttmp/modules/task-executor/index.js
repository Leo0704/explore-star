/**
 * 任务执行器（§3.6.5）
 *
 * 登录态浏览器 + 限速 + 风控信号 + 紧急停止 + 钩子审核
 *
 * V1 实现：mock 浏览器（不真调），留接口便于后续升级
 */
import { readFileSync, existsSync } from 'node:fs';
// ---------------------------------------------------------------------------
// 安全配置加载
// ---------------------------------------------------------------------------
export function loadSafetyConfig(configPath = 'config/safety.json') {
    try {
        const raw = readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        // fallback 默认值
        return {
            rate_limits: {
                douyin: {
                    search_calls_per_hour: 10,
                    user_videos_calls_per_hour: 30,
                    friend_request_per_day: 5,
                    dm_per_day: 10,
                },
                min_interval_seconds: 3,
                max_interval_seconds: 8,
            },
            daily_budget: {
                videos: 50,
                comments_scanned: 5000,
                leads_created: 200,
                engagement_actions: 20,
            },
            emergency_stop: 'config/EMERGENCY_STOP',
            fatal_signals: [
                'auth_wall_detected',
                'captcha_triggered_3_times_in_1h',
                'private_msg_rejected_2_times',
                'ip_changed_5_times',
            ],
        };
    }
}
// ---------------------------------------------------------------------------
// 紧急停止检查
// ---------------------------------------------------------------------------
export function isEmergencyStop(config) {
    return existsSync(config.emergency_stop);
}
export function throwIfEmergencyStop(config) {
    if (isEmergencyStop(config)) {
        throw new Error('紧急停止开关已启用，终止执行');
    }
}
export function createRateLimiter() {
    const counters = {
        friend_requests_today: 0,
        dm_today: 0,
        last_action_ms: 0,
    };
    return {
        canFriendRequest(config) {
            return counters.friend_requests_today < config.rate_limits.douyin.friend_request_per_day;
        },
        canDm(config) {
            return counters.dm_today < config.rate_limits.douyin.dm_per_day;
        },
        recordFriendRequest() {
            counters.friend_requests_today++;
        },
        recordDm() {
            counters.dm_today++;
        },
        /** 随机间隔（3-8 秒真人节律） */
        randomInterval(config) {
            const { min_interval_seconds, max_interval_seconds } = config.rate_limits;
            return Math.floor(Math.random() * (max_interval_seconds - min_interval_seconds + 1) + min_interval_seconds) * 1000;
        },
        /** 等待随机间隔（真人节律） */
        async waitForInterval(config) {
            const ms = this.randomInterval(config);
            await new Promise(resolve => setTimeout(resolve, ms));
            counters.last_action_ms = Date.now();
        },
        /** 重置每日计数（供编排器在每天开始时调用） */
        resetDaily() {
            counters.friend_requests_today = 0;
            counters.dm_today = 0;
        },
        getCounters() {
            return { ...counters };
        },
    };
}
/**
 * 钩子审核模式：将任务写入飞书/微信等多维表，人工标记后再执行
 * V1 实现：直接批准（mock），留接口
 */
export async function reviewHook(task, reviewConfig) {
    if (!reviewConfig) {
        return { approved: true };
    }
    // TODO: 接入飞书/微信多维表审核 API
    // 1. 写入待审核任务到多维表
    // 2. 轮询审核状态（approved/modified/skipped）
    // 3. 返回审核结果
    // V1 mock：直接批准
    return { approved: true };
}
/**
 * 通过登录态浏览器执行单个任务
 * V1 实现：mock 返回成功，不真调浏览器
 */
export async function browserExecute(task, _opts = {}) {
    // 模拟执行延迟
    await new Promise(resolve => setTimeout(resolve, 500));
    // V1 mock：根据 action 返回模拟结果
    // 真实实现需要：
    // 1. 启动 puppeteer 或调用 opencli browser skill
    // 2. 导航到目标页面
    // 3. 执行对应操作（like/comment/friend/dm）
    // 4. 检测风控信号（滑块/限流/IP切换）
    // 5. 返回执行结果
    const result = {
        task_id: task.task_id,
        lead_cid: task.lead_cid,
        action: task.next_action,
        result: 'executed_with_response',
        executed_at: new Date().toISOString(),
        response_text: undefined,
    };
    return result;
}
// ---------------------------------------------------------------------------
// 批量任务执行
// ---------------------------------------------------------------------------
export async function executeTasks(tasks, config, opts = {}) {
    const results = [];
    const rateLimiter = createRateLimiter();
    const hookReview = config.hook_review ?? true;
    for (const task of tasks) {
        // 1. 检查紧急停止开关
        throwIfEmergencyStop(config);
        // 2. 等待到 scheduled_at
        const scheduledMs = new Date(task.scheduled_at).getTime();
        const now = Date.now();
        if (scheduledMs > now) {
            await new Promise(resolve => setTimeout(resolve, scheduledMs - now));
        }
        // 3. 钩子审核（如需）
        const reviewResult = await reviewHook(task, hookReview);
        if (!reviewResult.approved) {
            results.push({
                task_id: task.task_id,
                lead_cid: task.lead_cid,
                action: task.next_action,
                result: 'skipped',
                executed_at: new Date().toISOString(),
                error_message: reviewResult.reason ?? '钩子审核未通过',
            });
            continue;
        }
        // 4. 使用修改后的钩子（如有）
        const taskToExecute = reviewResult.modified_hook
            ? { ...task, hook: reviewResult.modified_hook }
            : task;
        // 5. 限速检查
        if (taskToExecute.next_action === 'friend_request' && !rateLimiter.canFriendRequest(config)) {
            results.push({
                task_id: taskToExecute.task_id,
                lead_cid: taskToExecute.lead_cid,
                action: taskToExecute.next_action,
                result: 'skipped',
                executed_at: new Date().toISOString(),
                error_message: '今日好友申请已达上限',
            });
            break;
        }
        if (taskToExecute.next_action === 'dm' && !rateLimiter.canDm(config)) {
            results.push({
                task_id: taskToExecute.task_id,
                lead_cid: taskToExecute.lead_cid,
                action: taskToExecute.next_action,
                result: 'skipped',
                executed_at: new Date().toISOString(),
                error_message: '今日私信已达上限',
            });
            break;
        }
        // 6. 真人节律随机延迟
        await rateLimiter.waitForInterval(config);
        // 7. 执行
        const result = await browserExecute(taskToExecute, opts);
        // 8. 限速计数
        if (taskToExecute.next_action === 'friend_request') {
            rateLimiter.recordFriendRequest();
        }
        if (taskToExecute.next_action === 'dm') {
            rateLimiter.recordDm();
        }
        results.push(result);
        // 9. 风控信号检测
        if (result.risk_signal) {
            if (result.risk_signal.action === 'emergency_stop') {
                throw new Error(`风控信号触发：${result.risk_signal.type}，紧急停止`);
            }
            if (result.risk_signal.action === 'stop_today') {
                break;
            }
        }
    }
    return results;
}
// ---------------------------------------------------------------------------
// 风控信号处理
// ---------------------------------------------------------------------------
export function createRiskSignal(type, config) {
    const fatalSignals = {
        captcha_triggered_3_times_in_1h: 'stop_today',
        private_msg_rejected_2_times: 'emergency_stop',
        ip_changed_5_times: 'emergency_stop',
        account_ban: 'emergency_stop',
    };
    return {
        type,
        count: 1,
        action: fatalSignals[type] ?? 'pause_1h',
    };
}
// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------
export async function runCLI(args) {
    const get = (flag) => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const tasksPath = get('--tasks') || 'data/tmp/tasks.json';
    const configPath = get('--config') || 'config/safety.json';
    const outputPath = get('--output') || 'data/tmp/execution-results.json';
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    // 读取任务和配置
    const tasks = JSON.parse(await readFile(tasksPath, 'utf-8'));
    const config = loadSafetyConfig(configPath);
    // 执行
    const results = await executeTasks(tasks, config);
    // 输出结果
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`[task-executor] 执行 ${results.length} 任务 → ${outputPath}`);
}
if (import.meta.url === `file://${process.argv[1]}`) {
    runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
//# sourceMappingURL=index.js.map