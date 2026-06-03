import type { Task } from '../../core/types.js';
import type { ExecutionResult, RiskSignal } from './index.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'browser-actions' });

const SIGNAL_ACTIONS: Record<string, RiskSignal['action']> = {
  captcha: 'pause_1h',
  rate_limit: 'pause_1h',
  account_ban: 'emergency_stop',
};

function createRiskSignal(type: RiskSignal['type']): RiskSignal {
  return { type, count: 1, action: SIGNAL_ACTIONS[type] ?? 'pause_1h' };
}

async function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise(r => setTimeout(r, ms));
}

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
  } catch {}
}

async function detectRisk(page: any): Promise<RiskSignal | null> {
  const hasRisk = await page.evaluate(`(() => {
    const text = document.body?.innerText || '';
    if (/验证码|captcha|slider|verify/i.test(text)) return 'captcha';
    if (/账号.*封|封禁|suspended|banned|永久限制/i.test(text)) return 'account_ban';
    return null;
  })()`);
  return hasRisk ? createRiskSignal(hasRisk) : null;
}

export async function likeAndFollow(videoUrl: string): Promise<{ ok: boolean; riskSignal?: RiskSignal; error?: string }> {
  const page = await getPage();
  try {
    await page.goto(videoUrl);
    await humanDelay(3000, 6000);

    await page.evaluate(`(() => {
      const btn = document.querySelector('[data-e2e="browse-like"]') || document.querySelector('[class*="like-btn"]');
      if (btn) btn.click();
    })()`);
    await humanDelay(2000, 4000);

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

export async function commentReply(videoUrl: string, text: string): Promise<{ ok: boolean; riskSignal?: RiskSignal; error?: string }> {
  const page = await getPage();
  try {
    await page.goto(videoUrl);
    await humanDelay(3000, 6000);

    await page.evaluate(`(() => {
      const list = document.querySelector('[data-e2e="comment-list"]');
      if (list) list.scrollIntoView({behavior: 'instant', block: 'start'});
    })()`);
    await humanDelay(2000, 4000);

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

    await page.click('.public-DraftEditor-content');
    await humanDelay(500, 1500);

    for (const char of text) {
      await page.type('.public-DraftEditor-content', char, { delay: 0 });
      await humanDelay(100, 300);
    }
    await humanDelay(1000, 3000);

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

export async function friendRequest(userSecUid: string): Promise<{ ok: boolean; riskSignal?: RiskSignal; error?: string }> {
  const page = await getPage();
  try {
    await page.goto(`https://www.douyin.com/user/${userSecUid}`);
    await humanDelay(3000, 6000);

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

export async function sendDirectMessage(userSecUid: string, text: string): Promise<{ ok: boolean; riskSignal?: RiskSignal; error?: string }> {
  const page = await getPage();
  try {
    await page.goto(`https://www.douyin.com/user/${userSecUid}`);
    await humanDelay(3000, 6000);

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

    await page.evaluate(`(() => {
      const input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (input) {
        input.textContent = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await humanDelay(1000, 3000);

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
