import { logger } from './logger.js';
import type { Notifier, RateLimits } from './types.js';

const log = logger.child({ module: 'rate-limiter' });

export interface ChannelRateLimitsConfig {
  search_qps: number;
  user_videos_qps: number;
  comment_qps: number;
  friend_request_per_day: number;
  dm_per_day: number;
}

interface RateLimiterOptions {
  channelLimits: ChannelRateLimitsConfig;
  adapterLimits: RateLimits;
  notifier?: Notifier;
  sleep?: (ms: number) => Promise<void>;
}

type QpsResource = 'search' | 'user_videos' | 'comment';

export class RateLimiter {
  private lastCallMs: Record<QpsResource, number> = { search: 0, user_videos: 0, comment: 0 };
  private haltedResources = new Set<QpsResource>();
  private friendRequestToday = 0;
  private dmToday = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly notifier?: Notifier;
  private readonly channelLimits: ChannelRateLimitsConfig;
  private readonly adapterLimits: RateLimits;

  private constructor(opts: RateLimiterOptions) {
    this.channelLimits = opts.channelLimits;
    this.adapterLimits = opts.adapterLimits;
    this.notifier = opts.notifier;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  static fromConfig(opts: RateLimiterOptions): RateLimiter {
    const rl = new RateLimiter(opts);
    for (const [resource, qps] of [
      ['search', opts.channelLimits.search_qps],
      ['user_videos', opts.channelLimits.user_videos_qps],
      ['comment', opts.channelLimits.comment_qps],
    ] as Array<[QpsResource, number]>) {
      if (qps === 0 && !rl.haltedResources.has(resource)) {
        rl.haltedResources.add(resource);
        log.error({ resource }, 'QPS=0 — 渠道停服');
        if (rl.notifier) {
          void rl.notifier.send({
            title: `[探星] 渠道停服 · ${resource} QPS=0`,
            body: `${resource} qps 配置为 0，run 终止。请检查 channels.yaml channel_rate_limits。`,
            level: 'critical',
          });
        }
      }
    }
    return rl;
  }

  async waitForSearch(): Promise<void> { return this.waitWithQps('search', this.channelLimits.search_qps); }
  async waitForUserVideos(): Promise<void> { return this.waitWithQps('user_videos', this.channelLimits.user_videos_qps); }
  async waitForComment(): Promise<void> { return this.waitWithQps('comment', this.channelLimits.comment_qps); }

  canFriendRequest(): boolean {
    return this.friendRequestToday < Math.min(this.channelLimits.friend_request_per_day, this.adapterLimits.friend_request_per_day);
  }
  canDm(): boolean {
    return this.dmToday < Math.min(this.channelLimits.dm_per_day, this.adapterLimits.dm_per_day);
  }
  recordFriendRequest(): void { this.friendRequestToday++; }
  recordDm(): void { this.dmToday++; }

  private async waitWithQps(resource: QpsResource, qps: number): Promise<void> {
    if (this.haltedResources.has(resource)) {
      throw new Error(`Rate limit halted: ${resource} qps=0 (escalated, no more calls allowed)`);
    }
    if (qps === 0) {
      this.haltedResources.add(resource);
      throw new Error(`Rate limit halted: ${resource} qps=0 (escalated, no more calls allowed)`);
    }
    const minIntervalMs = 1000 / qps;
    const elapsed = Date.now() - this.lastCallMs[resource];
    if (elapsed < minIntervalMs) {
      await this.sleep(minIntervalMs - elapsed);
    }
    this.lastCallMs[resource] = Date.now();
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
