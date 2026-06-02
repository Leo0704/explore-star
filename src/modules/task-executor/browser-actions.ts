/**
 * 真实浏览器动作（§3.6.5）—— puppeteer-core 实现
 *
 * 4 个 action:
 *   - like_and_follow: 打开视频页 → 点赞 → 关注作者
 *   - comment_reply:  打开视频页 → 评论区 → 输入 hook → 发送
 *   - friend_request: 打开用户主页 → 点击「关注」
 *   - dm:             打开用户主页 → 私信入口 → 输入 hook → 发送
 *
 * V1.4 抖音选择器为 best-effort（基于公开 douyin.com 页面结构）；
 * 抖音改版后需要用户/维护者手动更新。
 *
 * 重要：本文件无 mock——mock 仅出现在 src/modules/task-executor/__mocks__/ 下供单测使用。
 */

import type { Task } from '../../core/types.js';
import type { ExecutionResult, RiskSignal } from './index.js';
import { resolveChromePath } from './chrome-paths.js';

// ---------------------------------------------------------------------------
// 风控信号工具
// ---------------------------------------------------------------------------

const SIGNAL_ACTIONS: Record<string, RiskSignal['action']> = {
  captcha_triggered_3_times_in_1h: 'stop_today',
  private_msg_rejected_2_times: 'emergency_stop',
  ip_changed_5_times: 'emergency_stop',
  account_ban: 'emergency_stop',
  slider: 'pause_1h',
  rate_limit: 'pause_1h',
  ip_switch: 'stop_today',
};

function createRiskSignal(type: RiskSignal['type']): RiskSignal {
  return { type, count: 1, action: SIGNAL_ACTIONS[type] ?? 'pause_1h' };
}

// ---------------------------------------------------------------------------
// puppeteer-core 动态加载（允许在测试环境无 puppeteer 时降级）
// ---------------------------------------------------------------------------

let puppeteerModule: typeof import('puppeteer-core') | null = null;

async function getPuppeteer(): Promise<typeof import('puppeteer-core') | null> {
  if (puppeteerModule) return puppeteerModule;
  try {
    puppeteerModule = await import('puppeteer-core');
    return puppeteerModule;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 浏览器配置
// ---------------------------------------------------------------------------

export interface BrowserConfig {
  /** Chrome 可执行文件路径 */
  executablePath?: string;
  /** Chrome 用户数据目录（探星Profile） */
  userDataDir: string;
  /** 无头模式（默认 false，需登录态必须用有头） */
  headless?: boolean;
  /** 抖音 base URL */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://www.douyin.com';

// ---------------------------------------------------------------------------
// 浏览器单例（按 userDataDir 复用 launch 出来的实例）
// ---------------------------------------------------------------------------

let _browser: import('puppeteer-core').Browser | null = null;
let _browserUserDataDir: string | null = null;

export async function launchBrowser(config: BrowserConfig): Promise<import('puppeteer-core').Browser | null> {
  if (_browser && _browserUserDataDir === config.userDataDir) {
    return _browser;
  }
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }

  const puppeteer = await getPuppeteer();
  if (!puppeteer) return null;

  // 解析 Chrome 路径（env > config.executablePath > puppeteer 默认值）；
  // 找不到 throw —— 这是配置错误，不是 per-task 失败
  // 可选链：允许旧测试/调用方在 config 缺失时走 puppeteer 默认
  const executablePath = await resolveChromePath(config?.executablePath);

  try {
    _browser = await puppeteer.launch({
      executablePath,
      headless: config.headless ?? false,
      // 关键：userDataDir 让 puppeteer 复用 Chrome Profile（已登录态）
      args: [
        `--user-data-dir=${config.userDataDir}`,
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
      defaultViewport: { width: 1280, height: 800 },
    });
    _browserUserDataDir = config.userDataDir;
    return _browser;
  } catch (e) {
    console.error(`[browser-actions] 启动浏览器失败：${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 风控信号检测
// ---------------------------------------------------------------------------

async function detectRiskSignal(page: import('puppeteer-core').Page): Promise<ReturnType<typeof createRiskSignal> | null> {
  // 滑块验证
  const slider = await page.$('.secsdk-captcha-drag-icon, [class*="captcha"], [class*="slider"]');
  if (slider) {
    return createRiskSignal('slider');
  }
  // 登录墙
  const loginWall = await page.$('[class*="login"], [class*="auth"]');
  if (loginWall) {
    return createRiskSignal('account_ban');
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4 个 Action 实现
// ---------------------------------------------------------------------------

/**
 * 点赞 + 关注作者
 */
export async function likeAndFollow(
  videoUrl: string,
  browser: import('puppeteer-core').Browser,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<{ ok: boolean; riskSignal?: ReturnType<typeof createRiskSignal>; error?: string }> {
  const page = await browser.newPage();
  try {
    const url = videoUrl.startsWith('http') ? videoUrl : `${baseUrl}${videoUrl}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 等待渲染
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    // 点赞
    const likeBtn = await page.$('[data-e2e="browse-like"], [class*="like-btn"], [class*="likeBtn"]');
    if (likeBtn) {
      await likeBtn.click();
      await new Promise(r => setTimeout(r, 800));
    }

    // 关注
    const followBtn = await page.$('[data-e2e="follow-btn"], [class*="follow-btn"], [class*="followBtn"]');
    if (followBtn) {
      await followBtn.click();
      await new Promise(r => setTimeout(r, 800));
    }

    // 风控检测
    const risk = await detectRiskSignal(page);
    if (risk) return { ok: false, riskSignal: risk };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 评论回复
 */
export async function commentReply(
  videoUrl: string,
  text: string,
  browser: import('puppeteer-core').Browser,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<{ ok: boolean; riskSignal?: ReturnType<typeof createRiskSignal>; error?: string }> {
  const page = await browser.newPage();
  try {
    const url = videoUrl.startsWith('http') ? videoUrl : `${baseUrl}${videoUrl}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    // 找评论输入框
    const input = await page.$('[data-e2e="comment-input"], [class*="comment-input"], [class*="CommentInput"], textarea[placeholder*="说点什么"]');
    if (!input) {
      return { ok: false, error: '未找到评论输入框' };
    }
    await input.click();
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.type(text, { delay: 50 });
    await new Promise(r => setTimeout(r, 500));

    // 发送
    const sendBtn = await page.$('[data-e2e="comment-send"], [class*="comment-send"], [class*="sendBtn"], button[type="submit"]');
    if (sendBtn) {
      await sendBtn.click();
      await new Promise(r => setTimeout(r, 1500));
    } else {
      // 备选：按 Enter
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 1500));
    }

    const risk = await detectRiskSignal(page);
    if (risk) return { ok: false, riskSignal: risk };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 好友申请（关注用户）
 */
export async function friendRequest(
  userSecUid: string,
  browser: import('puppeteer-core').Browser,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<{ ok: boolean; riskSignal?: ReturnType<typeof createRiskSignal>; error?: string }> {
  const page = await browser.newPage();
  try {
    const url = `${baseUrl}/user/${userSecUid}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 2000));

    const followBtn = await page.$('[data-e2e="follow-btn"], [class*="follow-btn"], [class*="followBtn"]');
    if (!followBtn) {
      return { ok: false, error: '未找到关注按钮' };
    }
    const text = await page.evaluate(el => el.textContent ?? '', followBtn);
    if (text.includes('已关注') || text.includes('互相关注')) {
      return { ok: true };  // 已关注算成功
    }
    await followBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    const risk = await detectRiskSignal(page);
    if (risk) return { ok: false, riskSignal: risk };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 私信
 */
export async function sendDirectMessage(
  userSecUid: string,
  text: string,
  browser: import('puppeteer-core').Browser,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<{ ok: boolean; riskSignal?: ReturnType<typeof createRiskSignal>; error?: string }> {
  const page = await browser.newPage();
  try {
    const url = `${baseUrl}/user/${userSecUid}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 2000));

    // 找私信入口
    const dmBtn = await page.$('[data-e2e="user-dm"], [class*="user-dm"], [class*="messageBtn"], [class*="私信"]');
    if (!dmBtn) {
      return { ok: false, error: '未找到私信入口' };
    }
    await dmBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // 输入
    const input = await page.$('[data-e2e="dm-input"], [class*="dm-input"], textarea[placeholder*="发消息"]');
    if (!input) {
      return { ok: false, error: '未找到私信输入框' };
    }
    await input.click();
    await page.keyboard.type(text, { delay: 50 });
    await new Promise(r => setTimeout(r, 500));

    // 发送
    const sendBtn = await page.$('[data-e2e="dm-send"], [class*="dm-send"], button[type="submit"]');
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
    await new Promise(r => setTimeout(r, 1500));

    const risk = await detectRiskSignal(page);
    if (risk) return { ok: false, riskSignal: risk };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 主入口：执行浏览器动作（V1.4 真实 puppeteer）
// ---------------------------------------------------------------------------

/**
 * 执行单个任务的浏览器动作
 *
 * - 当 puppeteer 可用且 browserConfig 提供时，调真实浏览器
 * - 当 puppeteer 不可用（如 CI 环境）时，返回 failed_network 并报错
 *
 * 严禁 mock——本函数必须真做浏览器操作或显式报错。
 */
export async function executeBrowserAction(
  task: Task,
  browserConfig: BrowserConfig,
): Promise<ExecutionResult> {
  const baseResult: ExecutionResult = {
    task_id: task.task_id,
    lead_cid: task.lead_cid,
    action: task.next_action,
    result: 'executed_with_response',
    executed_at: new Date().toISOString(),
  };

  const browser = await launchBrowser(browserConfig);
  if (!browser) {
    return {
      ...baseResult,
      result: 'failed_network',
      error_message: 'puppeteer-core 未安装或 Chrome 不可用；请 npm install puppeteer-core 并确保 Chrome 已安装',
    };
  }

  // send_material 不通过浏览器（由 §3.10 转化引擎的 Notifier 推送物料）
  if (task.next_action === 'send_material') {
    return baseResult;
  }

  // 提取必要参数
  // aweme_id 来源：task.lead_cid 是评论 ID；需要从 lead 拿 video_url 和 user_uid
  // V1.4 简化：从 task 字段推断——但当前 Task 接口没有 video_url/user_uid
  // 业务方应在生成 task 时把这些塞进 custom_fields
  const customFields = (task as any).custom_fields ?? {};
  const videoUrl = customFields.video_url as string | undefined;
  const userSecUid = customFields.user_sec_uid as string | undefined;

  let outcome: { ok: boolean; riskSignal?: ReturnType<typeof createRiskSignal>; error?: string };

  try {
    switch (task.next_action) {
      case 'like_and_follow':
        if (!videoUrl) {
          return { ...baseResult, result: 'failed_network', error_message: 'task 缺 video_url（应在 lead 生成时注入）' };
        }
        outcome = await likeAndFollow(videoUrl, browser, browserConfig.baseUrl);
        break;
      case 'comment_reply':
        if (!videoUrl) {
          return { ...baseResult, result: 'failed_network', error_message: 'task 缺 video_url' };
        }
        outcome = await commentReply(videoUrl, task.hook, browser, browserConfig.baseUrl);
        break;
      case 'friend_request':
        if (!userSecUid) {
          return { ...baseResult, result: 'failed_network', error_message: 'task 缺 user_sec_uid' };
        }
        outcome = await friendRequest(userSecUid, browser, browserConfig.baseUrl);
        break;
      case 'dm':
        if (!userSecUid) {
          return { ...baseResult, result: 'failed_network', error_message: 'task 缺 user_sec_uid' };
        }
        outcome = await sendDirectMessage(userSecUid, task.hook, browser, browserConfig.baseUrl);
        break;
      default:
        return { ...baseResult, result: 'skipped', error_message: `未知 action: ${task.next_action}` };
    }
  } catch (e) {
    return { ...baseResult, result: 'failed_network', error_message: e instanceof Error ? e.message : String(e) };
  }

  if (!outcome.ok) {
    if (outcome.riskSignal) {
      return { ...baseResult, result: 'failed_risk', risk_signal: outcome.riskSignal, error_message: outcome.error };
    }
    return { ...baseResult, result: 'failed_network', error_message: outcome.error };
  }

  return baseResult;
}

