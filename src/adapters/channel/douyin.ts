import type {
  ChannelAdapter, Video, UserVideo, SearchQuery, RateLimits,
} from '../../core/types.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'douyin' });

let _bridge: any = null;
let _page: any = null;

async function getPage() {
  if (_page) return _page;
  // @ts-ignore — vendored opencli 编译产物
  const { BrowserBridge } = await import('../../../vendor/opencli/src/browser/bridge.js');
  _bridge = new BrowserBridge();
  _page = await _bridge.connect({ session: 'explore-star' });
  log.info('BrowserBridge 连接成功');
  return _page;
}

export async function disconnectDouyinChannel(): Promise<void> {
  try {
    if (_bridge) {
      await _bridge.close();
      _bridge = null;
      _page = null;
    }
    try {
      const { requestDaemonShutdown } = await import('../../../vendor/opencli/src/browser/daemon-client.js');
      await requestDaemonShutdown();
      log.info('opencli daemon 已关闭');
    } catch {
    }
  } catch (e) {
    log.warn({ err: e }, 'BrowserBridge 断开失败');
  }
}

function parseDouyinCount(text: string): number {
  if (typeof text !== 'string') return 0;
  const m = text.replace(/\s/g, '').match(/^(\d+(?:\.\d+)?)([万亿])?$/);
  if (!m) { const n = Number(text.replace(/[,\s]/g, '')); return Number.isFinite(n) ? Math.round(n) : 0; }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  if (m[2] === '万') return Math.round(n * 10_000);
  if (m[2] === '亿') return Math.round(n * 100_000_000);
  return Math.round(n);
}

function projectCard(card: any, index: number): Video | null {
  const href = card?.href ?? card?.url ?? '';
  let awemeId = '';
  const m = href.match(/\/video\/(\d+)/);
  if (m) awemeId = m[1];
  const url = awemeId ? `https://www.douyin.com/video/${awemeId}` : href;
  const texts: string[] = Array.isArray(card?.leafTexts) ? card.leafTexts.map((t: any) => String(t ?? '').trim()).filter(Boolean) : [];
  let likes = 0, author = '', longest = '';
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) continue;
    if (!likes && /^\d+(\.\d+)?[万亿]?$/.test(t)) { likes = parseDouyinCount(t); continue; }
    if (t === '@' && !author) { author = (texts[i + 1] ?? '').trim(); continue; }
    if (t === author || /^(合集|视频|作者|刚刚|今天|昨天)$/.test(t)) continue;
    if (t.length > longest.length) longest = t;
  }
  if (!url || !longest) return null;
  return { rank: index + 1, desc: longest, author, url, plays: 0, likes, comments: 0, shares: 0, aweme_id: awemeId };
}

export class DouyinChannel implements ChannelAdapter {
  readonly name = 'douyin';
  readonly rateLimits: RateLimits = {
    search_per_hour: 10, user_videos_per_hour: 30, comment_per_hour: 60,
    friend_request_per_day: 5, dm_per_day: 10,
  };

  async search(query: SearchQuery): Promise<Video[]> {
    if (!query.keywords?.length) throw new Error('Douyin search 需要至少 1 个关键词');
    const page = await getPage();
    const all: Video[] = [];
    for (const kw of query.keywords) {
      try {
        await page.goto(`https://www.douyin.com/search/${encodeURIComponent(kw)}?type=video`);
        await new Promise(r => setTimeout(r, 5000));
        const cards = await page.evaluate(`(() => {
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
        })()`) as any[];
        if (Array.isArray(cards)) {
          for (let i = 0; i < Math.min(cards.length, query.limit); i++) {
            const v = projectCard(cards[i], all.length);
            if (v) all.push(v);
          }
        }
      } catch (e) { log.warn({ err: e, keyword: kw }, '搜索失败'); }
    }
    return all;
  }

  async getUserVideos(secUid: string, opts: { limit?: number; withComments?: boolean; commentLimit?: number } = {}): Promise<UserVideo[]> {
    if (!secUid) throw new Error('Douyin getUserVideos 需要 sec_uid');
    const page = await getPage();
    const limit = Math.min(opts.limit ?? 20, 20);
    const commentLimit = opts.commentLimit ?? 10;
    await page.goto(`https://www.douyin.com/user/${secUid}`);
    await new Promise(r => setTimeout(r, 5000));

    const videoCards = await page.evaluate(`(() => {
      const cards = [];
      const items = document.querySelectorAll('[data-e2e="user-post-list"] li, .user-post-list li, a[href*="/video/"]');
      for (const item of items) {
        const a = item.tagName === 'A' ? item : item.querySelector('a[href*="/video/"]');
        if (!a) continue;
        const href = a.getAttribute('href') || '';
        const m = href.match(/\\/video\\/(\\d+)/);
        if (!m) continue;
        const texts = [];
        for (const el of item.querySelectorAll('*')) {
          if (el.children.length > 0) continue;
          const t = (el.textContent || '').trim();
          if (t) texts.push(t);
        }
        cards.push({ aweme_id: m[1], href, texts });
      }
      return cards;
    })()`) as any[];

    if (!Array.isArray(videoCards) || videoCards.length === 0) return [];

    const videos: UserVideo[] = [];
    for (let i = 0; i < Math.min(videoCards.length, limit); i++) {
      const v = videoCards[i];
      const title = v.texts.find((t: string) => t.length > 5) || v.texts[0] || '';

      // 获取评论
      let topComments: UserVideo['top_comments'] = [];
      if (opts.withComments !== false) {
        try {
          const rawComments = await this.getVideoComments(v.aweme_id, commentLimit);
          topComments = rawComments.map((c, idx) => ({
            cid: `${v.aweme_id}-comment-${idx}`,
            text: c.text,
            user: { nickname: c.nickname, uid: c.uid, follower_count: 0, signature: '' },
            digg_count: c.digg_count,
            create_time: 0,
            reply_count: 0,
          }));
        } catch (e) {
          log.warn({ err: e, aweme_id: v.aweme_id }, '获取视频评论失败');
        }
      }

      videos.push({
        index: i + 1, aweme_id: v.aweme_id, title,
        duration: 0, digg_count: 0, play_url: '', top_comments: topComments,
      });
    }
    return videos;
  }

  async getVideoComments(awemeId: string, count = 10): Promise<Array<{ text: string; digg_count: number; nickname: string; uid: string }>> {
    const page = await getPage();
    try {
      await page.goto(`https://www.douyin.com/video/${awemeId}`);
      await new Promise(r => setTimeout(r, 5000));

      for (let i = 0; i < 3; i++) {
        await page.evaluate(`(() => {
          const box = document.querySelector('[data-e2e="comment-list"]') || document.querySelector('.comment-mainContent');
          if (box) box.scrollTop = box.scrollHeight;
          else window.scrollBy(0, 800);
        })()`);
        await new Promise(r => setTimeout(r, 2000));
      }

      const comments = await page.evaluate(`(() => {
        const results = [];
        const items = document.querySelectorAll('[data-e2e="comment-item"]');
        for (const item of items) {
          const fullText = (item.textContent || '').trim();
          if (!fullText) continue;
          // 用 ... 分割昵称和评论内容
          const parts = fullText.split('...');
          const nickname = (parts[0] || '').trim();
          const rest = parts.slice(1).join('...') || '';
          // 提取评论文本（时间标记之前的部分）
          const timeMatch = rest.match(/(\\d+(?:周|天|月|年|小时|分钟)前)/);
          const commentText = timeMatch ? rest.slice(0, timeMatch.index).trim() : rest.trim();
          // 提取点赞数（时间·地点后面的数字）
          const likeMatch = rest.match(/(?:周|天|月|年|小时|分钟)前[^\\d]*(\\d+)/);
          const digg_count = likeMatch ? parseInt(likeMatch[1]) : 0;
          if (commentText && nickname) results.push({ text: commentText, digg_count, nickname });
        }
        return results;
      })()`) as any[];

      if (Array.isArray(comments) && comments.length > 0) {
        log.info({ awemeId, count: comments.length }, 'DOM 提取评论成功');
        return comments.slice(0, count).map((c: any) => ({
          text: c.text || '', digg_count: c.digg_count ?? 0, nickname: c.nickname || '', uid: '',
        }));
      }

      log.warn({ awemeId }, 'DOM 未找到评论元素');
      return [];
    } catch (e) {
      log.warn({ err: e, awemeId }, '评论采集失败');
      return [];
    }
  }

  async ping(): Promise<{ ok: boolean; loggedIn: boolean }> {
    try {
      await getPage();
      return { ok: true, loggedIn: true };
    } catch { return { ok: false, loggedIn: false }; }
  }
}

export async function registerDouyinChannel(): Promise<void> {
  const { registerChannel } = await import('../registry.js');
  registerChannel('douyin', new DouyinChannel());
}
