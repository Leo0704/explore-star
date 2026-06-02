/**
 * 抖音浏览器操作层
 *
 * 从 opencli 的 CDP + browserFetch 搬入，不再依赖外部 opencli CLI。
 * 通过 Chrome DevTools Protocol (CDP) 直连已运行的 Chrome。
 *
 * 前置条件：Chrome 启动时加 --remote-debugging-port=9222
 *   macOS: /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *   或者用 alias: alias chrome-debug='/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222'
 */

import type { Video, UserVideo } from '../../core/types.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'douyin-browser' });

// ---------------------------------------------------------------------------
// CDP 连接（从 opencli src/browser/cdp.ts 搬入，简化版）
// ---------------------------------------------------------------------------

const CDP_PORT = parseInt(process.env.CHROME_CDP_PORT ?? '9222', 10);
const CDP_URL = process.env.CHROME_CDP_URL ?? `http://127.0.0.1:${CDP_PORT}`;

let _ws: import('ws').WebSocket | null = null;
let _idCounter = 0;
const _pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

async function getCDP(): Promise<import('ws').WebSocket> {
  if (_ws && _ws.readyState === 1) return _ws;

  const { WebSocket } = await import('ws');
  const http = await import('node:http');

  // 获取 WebSocket URL
  const targets = await new Promise<any[]>((resolve, reject) => {
    http.get(`${CDP_URL}/json`, (res) => {
      let data = '';
      res.on('data', (chunk: string) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  // 找到 douyin 的 page target，或者第一个 page target
  const target = targets.find((t: any) => t.type === 'page' && t.url?.includes('douyin'))
    || targets.find((t: any) => t.type === 'page')
    || targets[0];

  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`Chrome CDP 未找到可调试的页面。请确保 Chrome 已启动并加了 --remote-debugging-port=${CDP_PORT}`);
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('CDP 连接超时'));
    }, 10000);

    ws.on('open', () => {
      clearTimeout(timeout);
      _ws = ws;

      // 设置事件监听
      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.id && _pending.has(msg.id)) {
            const p = _pending.get(msg.id)!;
            _pending.delete(msg.id);
            if (msg.error) {
              p.reject(new Error(`CDP error: ${msg.error.message}`));
            } else {
              p.resolve(msg.result);
            }
          }
        } catch { /* ignore parse errors */ }
      });

      ws.on('close', () => { _ws = null; });
      ws.on('error', (e: Error) => { log.warn({ err: e }, 'CDP WebSocket error'); _ws = null; });

      resolve(ws);
    });

    ws.on('error', (e: Error) => {
      clearTimeout(timeout);
      reject(new Error(`CDP 连接失败: ${e.message}。请确保 Chrome 已启动并加了 --remote-debugging-port=${CDP_PORT}`));
    });
  });
}

/** 通过 CDP 发送命令 */
async function cdpSend(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const ws = await getCDP();
  const id = ++_idCounter;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id);
        reject(new Error(`CDP 命令超时: ${method}`));
      }
    }, 30000);
  });
}

// ---------------------------------------------------------------------------
// browserFetch — 在浏览器内执行 fetch（自动带 cookie + a_bogus 签名）
// 从 opencli clis/douyin/_shared/browser-fetch.js 搬入
// ---------------------------------------------------------------------------

async function browserFetch(
  method: string,
  url: string,
  options: { headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<unknown> {
  const js = `
    (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ${options.timeoutMs ?? 30000});
      try {
        const res = await fetch(${JSON.stringify(url)}, {
          method: ${JSON.stringify(method)},
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...${JSON.stringify(options.headers ?? {})}
          },
          ${options.body ? `body: JSON.stringify(${JSON.stringify(options.body)}),` : ''}
        });
        const text = await res.text();
        try { return JSON.parse(text); }
        catch (e) { return { status_code: res.ok ? -2 : res.status, status_msg: 'JSON parse failed: ' + text.slice(0, 500) }; }
      } catch (e) { return { status_code: -1, status_msg: String(e?.message || e) }; }
      finally { clearTimeout(timer); }
    })()
  `;

  const result = await cdpSend('Runtime.evaluate', {
    expression: js,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result?.result?.value;
  if (value == null) throw new Error(`Empty response from ${method} ${url}`);
  if (typeof value === 'object' && 'status_code' in value && (value as any).status_code !== 0) {
    throw new Error(`Douyin API error ${(value as any).status_code}: ${(value as any).status_msg}`);
  }
  return value;
}

/** 确保当前页面在抖音域名上 */
async function ensureDouyinDomain(): Promise<void> {
  const result = await cdpSend('Runtime.evaluate', {
    expression: 'window.location.href',
    returnByValue: true,
  });
  const href = result?.result?.value as string || '';
  if (!href.includes('douyin.com')) {
    await cdpSend('Page.navigate', { url: 'https://www.douyin.com' });
    // 等页面加载
    await new Promise(r => setTimeout(r, 3000));
  }
}

// ---------------------------------------------------------------------------
// 1. 搜索视频（DOM 提取，从 opencli search.js 搬入）
// ---------------------------------------------------------------------------

export interface SearchResult {
  rank: number;
  desc: string;
  author: string;
  url: string;
  aweme_id: string;
  likes: number;
}

export async function searchVideos(keyword: string, limit = 10): Promise<SearchResult[]> {
  await ensureDouyinDomain();

  // 导航到搜索页
  await cdpSend('Page.navigate', {
    url: `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`,
  });
  await new Promise(r => setTimeout(r, 5000)); // 等待渲染

  // DOM 提取搜索结果
  const extractScript = `
    (() => {
      const cards = [];
      const lis = document.querySelectorAll('[data-e2e="scroll-list"] li');
      for (const li of lis) {
        const a = li.querySelector('a[href*="/video/"]');
        if (!a) continue;
        const leafTexts = [];
        for (const el of li.querySelectorAll('*')) {
          if (el.children.length > 0) continue;
          const t = (el.textContent || '').trim();
          if (t) leafTexts.push(t);
        }
        cards.push({ href: a.getAttribute('href') || '', leafTexts });
      }
      return cards;
    })()
  `;

  const result = await cdpSend('Runtime.evaluate', {
    expression: extractScript,
    returnByValue: true,
  });

  const cards = result?.result?.value as any[] || [];
  if (cards.length === 0) {
    log.warn({ keyword }, '搜索无结果');
    return [];
  }

  // 投影搜索结果
  return cards.slice(0, limit).map((card: any, i: number) => {
    const href = card.href || '';
    let awemeId = '';
    const m = href.match(/\/video\/(\d+)/);
    if (m) awemeId = m[1];

    const texts: string[] = (card.leafTexts || []).map((t: string) => t.trim()).filter(Boolean);
    let likes = 0;
    let author = '';
    let longest = '';

    for (let j = 0; j < texts.length; j++) {
      const t = texts[j];
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) continue;
      if (!likes && /^\d+(\.\d+)?[万亿]?$/.test(t)) {
        const nm = t.match(/^(\d+(?:\.\d+)?)([万亿])?$/);
        if (nm) {
          const n = Number(nm[1]);
          likes = nm[2] === '万' ? Math.round(n * 10000) : nm[2] === '亿' ? Math.round(n * 100000000) : Math.round(n);
        }
        continue;
      }
      if (t === '@' && !author) { author = (texts[j + 1] || '').trim(); continue; }
      if (t === author) continue;
      if (/^(合集|视频|作者|刚刚|今天|昨天)$/.test(t)) continue;
      if (t.length > longest.length) longest = t;
    }

    return {
      rank: i + 1,
      desc: longest,
      author,
      url: awemeId ? `https://www.douyin.com/video/${awemeId}` : href,
      aweme_id: awemeId,
      likes,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. 拉视频评论（调抖音 Web API，从 opencli public-api.js 搬入）
// ---------------------------------------------------------------------------

export interface VideoComment {
  text: string;
  digg_count: number;
  nickname: string;
  uid: string;
}

export async function getVideoComments(awemeId: string, count = 10): Promise<VideoComment[]> {
  const params = new URLSearchParams({
    aweme_id: awemeId,
    count: String(count),
    cursor: '0',
    aid: '6383',
  });
  const data = await browserFetch('GET', `https://www.douyin.com/aweme/v1/web/comment/list/?${params.toString()}`, {
    headers: { referer: 'https://www.douyin.com/' },
  }) as any;

  return ((data?.comments || []) as any[]).slice(0, count).map((c: any) => ({
    text: c.text || '',
    digg_count: c.digg_count ?? 0,
    nickname: c.user?.nickname || '',
    uid: c.user?.uid || '',
  }));
}

// ---------------------------------------------------------------------------
// 3. 拉用户视频（调抖音 Web API，从 opencli public-api.js 搬入）
// ---------------------------------------------------------------------------

export async function getUserVideosFromBrowser(secUid: string, limit = 20): Promise<UserVideo[]> {
  const params = new URLSearchParams({
    sec_user_id: secUid,
    max_cursor: '0',
    count: String(limit),
    aid: '6383',
  });
  const data = await browserFetch('GET', `https://www.douyin.com/aweme/v1/web/aweme/post/?${params.toString()}`, {
    headers: { referer: 'https://www.douyin.com/' },
  }) as any;

  return ((data?.aweme_list || []) as any[]).slice(0, limit).map((v: any, i: number) => ({
    index: i + 1,
    aweme_id: v.aweme_id || '',
    title: v.desc || '',
    duration: Math.round((v.video?.duration ?? 0) / 1000),
    digg_count: v.statistics?.digg_count ?? 0,
    play_url: v.video?.play_addr?.url_list?.[0] ?? '',
    top_comments: [],
  }));
}

// ---------------------------------------------------------------------------
// 4. 登录态检查
// ---------------------------------------------------------------------------

export async function checkLogin(): Promise<{ loggedIn: boolean; uid?: string; nickname?: string }> {
  try {
    const data = await browserFetch('GET', 'https://creator.douyin.com/web/api/media/user/info/?aid=1128') as any;
    const u = data?.user_info ?? data?.user;
    if (u?.uid && u?.nickname) {
      return { loggedIn: true, uid: u.uid, nickname: u.nickname };
    }
    return { loggedIn: false };
  } catch {
    return { loggedIn: false };
  }
}
