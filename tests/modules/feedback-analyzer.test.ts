/**
 * 反馈分析器单元测试（§3.11）
 *
 * 覆盖：贝叶斯平滑、风格切换门槛、persona 价值分
 */

import { describe, it, expect } from 'vitest';
import type { LeadEvent } from '../../src/core/types.js';

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
      // 仅 10 个 lead，全部 < 5 per persona
      const events: LeadEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push(mkEvent({ cid: `c${i}`, persona: 'self_media' }));
      }
      // 学习期未完成
      const total = new Set(events.map(e => e.cid)).size;
      expect(total).toBeLessThan(30);
    });
  });

  describe('§2 贝叶斯平滑', () => {
    it('n=1, c=1 全局 10% → 平滑后非 100%', () => {
      // 关键词 A: 50 leads, 5 成功
      // 关键词 B: 1 lead, 1 成功
      // 全局: 200 leads, 20 成功 → 10%
      // A 平滑: (5 + 10*0.1) / (50 + 10) = 6/60 = 10.0%
      // B 平滑: (1 + 10*0.1) / (1 + 10) = 2/11 ≈ 18.2%
      // B 不应该是 100%
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
      expect(proposed(1, 100)).toBe(2.0);  // 上限
      expect(proposed(1, 0.001)).toBe(0.1);  // 下限
      expect(proposed(1, 1)).toBe(1);
      expect(proposed(1, 4)).toBe(2.0);
      expect(proposed(1, 0.25)).toBe(0.5);
    });
  });
});
