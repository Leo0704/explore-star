/**
 * 浏览器动作 —— 基于 vendored opencli BrowserBridge
 *
 * 所有操作使用已验证的抖音 DOM 选择器 + 人类节奏随机延迟。
 *
 * 选择器验证记录（2026-06-02）：
 *   - 评论输入框: `.public-DraftEditor-content`（需先点击"回复"按钮）
 *   - 发送按钮: `span.FbVIhLlK.Law8JZNu`（红色箭头）
 *   - 关注按钮: `button:has-text("关注")` → `.semi-button-primary`
 *   - 评论回复按钮: `div.riDGlQZm`（每条评论下的"回复"文字）
 */

import type { Task } from '../../core/types.js';
import type { ExecutionResult, RiskSignal } from './index.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'browser-actions' });

// ---------------------------------------------------------------------------
// 风控信号
// ---------------------------------------------------------------------------

const SIGNAL_ACTIONS: Record<string, RiskSignal['action']> = {
  captcha: 'pause_1h',
  rate_limit: 'pause_1h',
  account_ban: 'emergency_stop',
};

function createRiskSignal(type: RiskSignal['type']): RiskSignal {
  return { type, count: 1, action: SIGNAL_ACTIONS[type] ?? 'pause_1h' };
}

// ---------------------------------------------------------------------------
// 人类节奏延迟工具
// ---------------------------------------------------------------------------

/** 随机延迟 min-max 毫秒 */
async function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// BrowserBridge 懒加载
// ---------------------------------------------------------------------------

let _bridge: any = null;
let _page: any = null;

async function getPage() {
  if (_page) return _page;
  // @ts-ignore — vendored opencli 编译产物
  const { BrowserBridge } = await import('../../../vendor/opencli/src/browser/bridge.js');
  _bridge = new BrowserBridge();
  _page = await _bridge.connect({ session: 'explore-star-tasks' });
  log.info('BrowserBridge 连接成功（任务执行）');
  return _page;
}

export async function disconnectBrowser(): Promise<void> {
  try {
    if (_bridge) {
      await _bridge.close();
      _bridge = null;
      _page = null;
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 风控检测
// ---------------------------------------------------------------------------

async function detectRisk(page: any): Promise<RiskSignal | null> {
  const hasRisk = await page.evaluate(`(() => {
    const text = document.body?.innerText || '';
    if (/验证码|captcha|slider|verify/i.test(text)) return 'captcha';
    if (/账号.*封|封禁|suspended|banned|永久限制/i.test(text)) return 'account_ban';
    return null;
  })()`);
  return hasRisk ? createRiskSignal(hasRisk) : null;
}

// ---------------------------------------------------------------------------
// 4 个 Action 实现（用 BrowserBridge + 验证过的选择器）
// ---------------------------------------------------------------------------

/**
 * 点赞 + 关注作者
 */
export async function likeAndFollow(videoUrl: string): Promise<{ ok: boolean; riskSignal?: RiskSignal; error?: string }> {
  const page = await getPage();
  try {
    await page.goto(videoUrl);
    await humanDelay(3000, 6000);  // 等页面加载，模拟浏览

    // 点赞
    await page.evaluate(`(() => {
      const btn = document.querySelector('[data-e2e="browse-like"]') || document.querySelector('[class*="like-btn"]');
      if (btn) btn.click();
    })()`);
    await humanDelay(2000, 4000);

    // 关注
    await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (btn.textContent?.trim() === '关注' && btn.offsetParent !== null) {
          btn.click();
          return true;
        }
      }
      return false;
    })()`);
    await humanDelay(2000, 4000);

    const risk = await detectRisk(page);
    if (risk) return { ok: false, riskSignal: risk };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 评论回复（已验证的选择器 + 人类节奏）
 */
export async function commentReply(videoUrl: string, text: string): Promise<{ ok: boolean; riskSignal?: RiskSignal; error?: string }> {
  const page = await getPage();
  try {
    await page.goto(videoUrl);
    await humanDelay(3000, 6000);  // 模拟浏览视频

    // 滚动到评论区
    await page.evaluate(`(() => {
      const list = document.querySelector('[data-e2e="comment-list"]');
      if (list) list.scrollIntoView({behavior: 'instant', block: 'start'});
    })()`);
    await humanDelay(2000, 4000);

    // 点击第一条评论的"回复"按钮
    const clicked = await page.evaluate(`(() => {
      const replyBtns = document.querySelectorAll('.riDGlQZm');
      for (const btn of replyBtns) {
        if (btn.textContent?.trim() === '回复' && btn.offsetParent !== null) {
          btn.click();
          return true;
        }
      }
      return false;
    })()`);
    if (!clicked) return { ok: false, error: '未找到回复按钮' };
    await humanDelay(1000, 3000);

    // 点击评论输入框（.public-DraftEditor-content）
    await page.click('.public-DraftEditor-content');
    await humanDelay(500, 1500);

    // 逐字输入（模拟人类打字，触发真实键盘事件）
    for (const char of text) {
      await page.type('.public-DraftEditor-content', char, { delay: 0 });
      await humanDelay(100, 300);
    }
    await humanDelay(1000, 3000);

    // 点击红色箭头发送按钮（.FbVIhLlK.Law8JZNu）
    const sent = await page.evaluate(`(() => {
      const btn = document.querySelector('.FbVIhLlK.Law8JZNu');
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    if (!sent) return { ok: false, error: '未找到发送按钮' };
    await humanDelay(3000, 5000);

    const risk = await detectRisk(page);
    if (risk) return { ok: false, riskSignal: risk };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 关注用户
 */
export async function friendRequest(userSecUid: string): Promise<{ ok: boolean; riskSignal?: RiskSignal; error?: string }> {
  const page = await getPage();
  try {
    await page.goto(`https://www.douyin.com/user/${userSecUid}`);
    await humanDelay(3000, 6000);

    // 点击关注按钮
    const clicked = await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const text = btn.textContent?.trim();
        if (text === '关注' && btn.offsetParent !== null) {
          btn.click();
          return true;
        }
        if (text === '已关注' || text === '互相关注') return 'already';
      }
      return false;
    })()`);
    if (clicked === 'already') return { ok: true };
    if (!clicked) return { ok: false, error: '未找到关注按钮' };
    await humanDelay(2000, 4000);

    const risk = await detectRisk(page);
    if (risk) return { ok: false, riskSignal: risk };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 私信（需要进用户主页）
 */
export async function sendDirectMessage(userSecUid: string, text: string): Promise<{ ok: boolean; riskSignal?: RiskSignal; error?: string }> {
  const page = await getPage();
  try {
    await page.goto(`https://www.douyin.com/user/${userSecUid}`);
    await humanDelay(3000, 6000);

    // 找私信按钮
    const clicked = await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button, a');
      for (const btn of btns) {
        if (btn.textContent?.trim() === '私信' && btn.offsetParent !== null) {
          btn.click();
          return true;
        }
      }
      return false;
    })()`);
    if (!clicked) return { ok: false, error: '未找到私信按钮' };
    await humanDelay(2000, 4000);

    // 输入私信内容
    await page.evaluate(`(() => {
      const input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (input) {
        input.textContent = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await humanDelay(1000, 3000);

    // 发送
    await page.evaluate(`(() => {
      const btn = document.querySelector('.FbVIhLlK.Law8JZNu') || document.querySelector('[class*="send"]');
      if (btn) btn.click();
    })()`);
    await humanDelay(3000, 5000);

    const risk = await detectRisk(page);
    if (risk) return { ok: false, riskSignal: risk };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export interface BrowserConfig {
  baseUrl?: string;
}

export async function executeBrowserAction(
  task: Task,
  _browserConfig: BrowserConfig = {},
): Promise<ExecutionResult> {
  const baseResult: ExecutionResult = {
    task_id: task.task_id,
    lead_cid: task.lead_cid,
    action: task.next_action,
    result: 'executed_with_response',
    executed_at: new Date().toISOString(),
  };

  if (task.next_action === 'send_material') return { ...baseResult, result: 'skipped' };

  const videoUrl = task.video_url;
  const userSecUid = task.user_sec_uid;

  let outcome: { ok: boolean; riskSignal?: RiskSignal; error?: string };

  try {
    switch (task.next_action) {
      case 'like_and_follow':
        if (!videoUrl) return { ...baseResult, result: 'failed_network', error_message: 'no video_url' };
        outcome = await likeAndFollow(videoUrl);
        break;
      case 'comment_reply':
        if (!videoUrl) return { ...baseResult, result: 'failed_network', error_message: 'no video_url' };
        outcome = await commentReply(videoUrl, task.hook);
        break;
      case 'friend_request':
        if (!userSecUid) return { ...baseResult, result: 'failed_network', error_message: 'no user_sec_uid' };
        outcome = await friendRequest(userSecUid);
        break;
      case 'dm':
        if (!userSecUid) return { ...baseResult, result: 'failed_network', error_message: 'no user_sec_uid' };
        outcome = await sendDirectMessage(userSecUid, task.hook);
        break;
      default:
        return { ...baseResult, result: 'skipped' };
    }
  } catch (e) {
    return { ...baseResult, result: 'failed_network', error_message: e instanceof Error ? e.message : String(e) };
  }

  if (!outcome.ok) {
    if (outcome.riskSignal) return { ...baseResult, result: 'failed_risk', risk_signal: outcome.riskSignal, error_message: outcome.error };
    return { ...baseResult, result: 'failed_network', error_message: outcome.error };
  }

  return baseResult;
}
