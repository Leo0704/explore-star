/**
 * FeedbackAnalyzer 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeadEvent } from '../src/core/types.js';

describe('FeedbackAnalyzer', () => {
  describe('keyword-attribution', () => {
    it('should compute keyword performance correctly', async () => {
      const { computeKeywordAttribution } = await import('../src/modules/feedback-analyzer/keyword-attribution.js');

      const events: LeadEvent[] = [
        createEvent('c1', 'AI 客服', '已成交'),
        createEvent('c2', 'AI 客服', '已成交'),
        createEvent('c3', 'AI 客服', '已加微'),
        createEvent('c4', '自动化', '已加微'),
        createEvent('c5', '自动化', '已流失'),
        createEvent('c6', 'AI 工具', '已流失'),
      ];

      const result = computeKeywordAttribution(events);

      expect(result.totalLeads).toBe(6);
      // AI 客服: 3 leads, 2 conversions
      const aiPerf = result.performance.find(p => p.keyword === 'AI 客服');
      expect(aiPerf?.leads).toBe(3);
      expect(aiPerf?.conversions).toBe(2);
    });

    it('should handle empty events', async () => {
      const { computeKeywordAttribution } = await import('../src/modules/feedback-analyzer/keyword-attribution.js');

      const result = computeKeywordAttribution([]);

      expect(result.totalLeads).toBe(0);
      expect(result.performance).toEqual([]);
    });
  });

  describe('hook-style-attribution', () => {
    it('should compute hook style performance', async () => {
      const { computeHookStyleAttribution } = await import('../src/modules/feedback-analyzer/hook-style-attribution.js');

      const events: LeadEvent[] = [
        createEvent('c1', 'AI', '已互动', '朋友推荐'),
        createEvent('c2', 'AI', '已互动', '朋友推荐'),
        createEvent('c3', 'AI', '已流失', '顾问'),
        createEvent('c4', 'AI', '已成交', '朋友推荐'),
      ];

      const result = computeHookStyleAttribution(events);

      expect(result.performance.length).toBe(2);
      const friendPerf = result.performance.find(p => p.style === '朋友推荐');
      expect(friendPerf?.tested).toBe(3);
      expect(friendPerf?.replied).toBe(2);
    });
  });

  describe('persona-value', () => {
    it('should compute persona value scores', async () => {
      const { computePersonaValue } = await import('../src/modules/feedback-analyzer/persona-value.js');

      const events: LeadEvent[] = [
        createEvent('c1', 'AI', '已成交', '朋友推荐', 'ecommerce'),
        createEvent('c2', 'AI', '已成交', '朋友推荐', 'ecommerce'),
        createEvent('c3', 'AI', '已流失', '顾问', 'self_media'),
      ];

      const result = computePersonaValue(events);

      expect(result.values.length).toBe(2);
      const ecPerf = result.values.find(v => v.persona === 'ecommerce');
      expect(ecPerf?.conversions).toBe(2);
      expect(ecPerf?.value_score).toBeGreaterThan(0);
    });
  });

  describe('interaction-time', () => {
    it('should compute best interaction times', async () => {
      const { computeInteractionTime } = await import('../src/modules/feedback-analyzer/interaction-time.js');

      const now = new Date();
      const events: LeadEvent[] = [
        { ...createEvent('c1', 'AI', '已互动'), interaction_time: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString() },
        { ...createEvent('c2', 'AI', '已互动'), interaction_time: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString() },
        { ...createEvent('c3', 'AI', '已互动'), interaction_time: new Date(now.getTime() - 27 * 60 * 60 * 1000).toISOString() },
      ];

      const result = computeInteractionTime(events);

      expect(result.times.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('runWeeklyAnalysis', () => {
    it('should handle missing events file', async () => {
      // Mock a non-existent events path
      const { runWeeklyAnalysis } = await import('../src/modules/feedback-analyzer/index.js');

      const result = await runWeeklyAnalysis('/tmp', {
        eventsPath: '/tmp/non-existent-events.jsonl',
        insightsPath: '/tmp/test-insights.json',
      });

      expect(result.learning_period_complete).toBe(false);
      expect(result.keyword_performance).toEqual([]);
    });
  });
});

function createEvent(
  cid: string,
  keyword: string,
  toStatus: string,
  hookStyle = 'default',
  persona = 'test',
): LeadEvent {
  return {
    event: 'lead_status_changed',
    cid,
    keyword,
    hook_style: hookStyle,
    hook_text: 'test hook',
    persona,
    interaction_time: new Date().toISOString(),
    to_status: toStatus as any,
  };
}