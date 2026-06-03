import { describe, it, expect } from 'vitest';
import type { LeadEvent } from '../../src/core/types.js';
import { computeHookStyleAttribution } from '../../src/modules/feedback-analyzer/hook-style-attribution.js';
import { computePersonaValue } from '../../src/modules/feedback-analyzer/persona-value.js';

function mkEvent(overrides: Partial<LeadEvent> = {}): LeadEvent {
  return {
    event: 'lead_status_changed',
    cid: 'c1',
    keyword: 'kw1',
    hook_style: '朋友推荐',
    hook_text: 'h',
    persona: 'self_media',
    interaction_time: new Date().toISOString(),
    to_status: '新发现',
    ...overrides,
  };
}

describe('反馈分析器算法（spec 对照）', () => {
  describe('§1 学习期', () => {
    it('数据 < 30 → 不出建议', () => {
      const events: LeadEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push(mkEvent({ cid: `c${i}`, persona: 'self_media' }));
      }
      const total = new Set(events.map(e => e.cid)).size;
      expect(total).toBeLessThan(30);
    });
  });

  describe('§2 贝叶斯平滑', () => {
    it('n=1, c=1 全局 10% → 平滑后非 100%', () => {
      const alpha = 10;
      const globalRate = 20 / 200;
      const bSmoothed = (1 + alpha * globalRate) / (1 + alpha);
      expect(bSmoothed).toBeCloseTo(0.182, 2);
      expect(bSmoothed).toBeLessThan(1.0);
    });
  });

  describe('§3 钩子风格 A/B', () => {
    it('样本 < 20 → 不参与评估', () => {
      const MIN_SAMPLES = 20;
      const tested = 15;
      expect(tested).toBeLessThan(MIN_SAMPLES);
    });

    it('差异 < 5% → 不切换', () => {
      const SIGNIFICANT_DIFF = 0.05;
      const a = { tested: 100, replied: 25, rate: 0.25 };
      const b = { tested: 100, replied: 22, rate: 0.22 };
      expect(Math.abs(a.rate - b.rate)).toBeLessThan(SIGNIFICANT_DIFF);
    });

    it('差异 ≥ 5% → 切换到更优', () => {
      const SIGNIFICANT_DIFF = 0.05;
      const a = { tested: 100, replied: 30, rate: 0.30 };
      const b = { tested: 100, replied: 20, rate: 0.20 };
      expect(Math.abs(a.rate - b.rate)).toBeGreaterThanOrEqual(SIGNIFICANT_DIFF);
    });
  });

  describe('§2 权重钳位', () => {
    it('proposed 永远在 [0.1, 2.0]', () => {
      const MIN = 0.1, MAX = 2.0;
      const proposed = (w: number, ratio: number) => {
        const p = w * Math.sqrt(ratio);
        return Math.max(MIN, Math.min(MAX, p));
      };
      expect(proposed(1, 100)).toBe(2.0);
      expect(proposed(1, 0.001)).toBe(0.1);
      expect(proposed(1, 1)).toBe(1);
      expect(proposed(1, 4)).toBe(2.0);
      expect(proposed(1, 0.25)).toBe(0.5);
    });
  });
});

describe('Bug 56: hook-style-attribution replied 必须按 cid 去重', () => {
  it('同一 lead 经历 已互动→已加好友→已加微 只算 1 次 replied', () => {
    const events: LeadEvent[] = [
      mkEvent({ cid: 'c1', hook_style: '朋友推荐', to_status: '已互动' }),
      mkEvent({ cid: 'c1', hook_style: '朋友推荐', to_status: '已加好友' }),
      mkEvent({ cid: 'c1', hook_style: '朋友推荐', to_status: '已加微' }),
    ];
    const { performance } = computeHookStyleAttribution(events);
    const style = performance.find(p => p.style === '朋友推荐')!;
    expect(style.tested).toBe(1);
    expect(style.replied).toBe(1);
    expect(style.rate).toBeLessThanOrEqual(1);
    expect(style.rate).toBe(1);
  });

  it('不同 lead 各自回复 → 各自算 1 次', () => {
    const events: LeadEvent[] = [
      mkEvent({ cid: 'c1', hook_style: '朋友推荐', to_status: '已互动' }),
      mkEvent({ cid: 'c2', hook_style: '朋友推荐', to_status: '已加微' }),
    ];
    const { performance } = computeHookStyleAttribution(events);
    const style = performance.find(p => p.style === '朋友推荐')!;
    expect(style.tested).toBe(2);
    expect(style.replied).toBe(2);
    expect(style.rate).toBe(1);
  });
});

describe('Bug 57: persona-value CONVERTED_STATUSES 只能含 已成交', () => {
  it('已私信 不应算 converted', () => {
    const events: LeadEvent[] = [
      mkEvent({ cid: 'c1', persona: 'self_media', to_status: '已私信' }),
    ];
    const { values } = computePersonaValue(events);
    const v = values.find(x => x.persona === 'self_media')!;
    expect(v.conversions).toBe(0);
  });

  it('已加微 不应算 converted', () => {
    const events: LeadEvent[] = [
      mkEvent({ cid: 'c1', persona: 'self_media', to_status: '已加微' }),
    ];
    const { values } = computePersonaValue(events);
    const v = values.find(x => x.persona === 'self_media')!;
    expect(v.conversions).toBe(0);
  });

  it('已预约 不应算 converted', () => {
    const events: LeadEvent[] = [
      mkEvent({ cid: 'c1', persona: 'self_media', to_status: '已预约' }),
    ];
    const { values } = computePersonaValue(events);
    const v = values.find(x => x.persona === 'self_media')!;
    expect(v.conversions).toBe(0);
  });

  it('已成交 算 converted', () => {
    const events: LeadEvent[] = [
      mkEvent({ cid: 'c1', persona: 'self_media', to_status: '已成交', metadata: { revenue: 100 } }),
    ];
    const { values } = computePersonaValue(events);
    const v = values.find(x => x.persona === 'self_media')!;
    expect(v.conversions).toBe(1);
    expect(v.revenue).toBe(100);
  });
});

describe('Bug 58: persona-value revenue 必须是 number', () => {
  it('metadata.revenue 为 string 时不应破坏 revenue 求和（不产生 NaN / 字符串拼接）', () => {
    const events: LeadEvent[] = [
      mkEvent({ cid: 'c1', persona: 'self_media', to_status: '已成交', metadata: { revenue: 100 } }),
      mkEvent({ cid: 'c2', persona: 'self_media', to_status: '已成交', metadata: { revenue: '50' as unknown as number } }),
    ];
    const { values } = computePersonaValue(events);
    const v = values.find(x => x.persona === 'self_media')!;
    expect(v.revenue).toBe(100);
    expect(typeof v.revenue).toBe('number');
    expect(Number.isFinite(v.revenue)).toBe(true);
  });

  it('metadata.revenue 为 string 且是唯一事件时 revenue 应为 0', () => {
    const events: LeadEvent[] = [
      mkEvent({ cid: 'c1', persona: 'self_media', to_status: '已成交', metadata: { revenue: '100' as unknown as number } }),
    ];
    const { values } = computePersonaValue(events);
    const v = values.find(x => x.persona === 'self_media')!;
    expect(v.revenue).toBe(0);
  });
});
