/**
 * 引导引擎单元测试（§3.6）
 *
 * 覆盖：状态机推进、互动感知（§3.6.2）、智能放弃（§3.6.3）、再激活（§3.6.4）
 */

import { describe, it, expect } from 'vitest';
import { generateDailyTasks, findReactivatableLeads, reactivate } from '../../src/modules/nurture-engine/index.js';
import type { Lead, LeadStatus, BusinessProfile, ConversionConfig } from '../../src/core/types.js';

const profile: BusinessProfile = {
  business: { name: 'Test', value_prop: 'Test' },
  target_personas: [
    { id: 'self_media', name: '自媒体', typical_pain_points: ['x'], value_score: 9.0 },
    { id: 'ecommerce', name: '电商', typical_pain_points: ['x'], value_score: 4.0 },
  ],
  intent_signals: ['AI'],
  llm: { provider: 'deepseek', model: 'deepseek-v3', api_key_env: 'X' },
  crm: { type: 'csv', config: {} },
};

const conversion: ConversionConfig = {
  lifecycle_states: [
    { id: 'discovered', name: '新发现', is_terminal: false },
    { id: 'wechat_added', name: '已加微', is_terminal: false },
    { id: 'closed', name: '已成交', is_terminal: true },
    { id: 'lost', name: '已流失', is_terminal: true },
  ],
  success_states: ['closed'],
};

function mkLead(overrides: Partial<Lead> = {}): Lead {
  return {
    cid: 'c1',
    source: 'douyin_user_videos',
    aweme_id: 'v1',
    video_url: 'https://...',
    video_desc: 'desc',
    keyword: 'kw',
    nickname: 'Test',
    user_signature: '',
    follower_count: 0,
    user_uid: 'u1',
    comment_text: 'hi',
    comment_digg_count: 0,
    comment_create_time: new Date().toISOString(),
    is_target_persona: true,
    persona: 'self_media',
    pain_point: 'p',
    intent_score: 0.8,
    buying_stage: 'awareness',
    suggested_reply_hook: 'h1',
    suggested_dm_hook: 'h2',
    status: '新发现',
    status_history: [],
    execution_count: 0,
    response_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('引导引擎', () => {
  describe('状态机推进', () => {
    it('新发现 → 任务 = like_and_follow', () => {
      const tasks = generateDailyTasks([mkLead()], { profile, conversion });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].next_action).toBe('like_and_follow');
    });

    it('已关注 → 任务 = comment_reply', () => {
      const tasks = generateDailyTasks([mkLead({ status: '已关注' })], { profile, conversion });
      expect(tasks[0].next_action).toBe('comment_reply');
    });

    it('已私信 → 任务 = send_material', () => {
      const tasks = generateDailyTasks([mkLead({ status: '已私信' })], { profile, conversion });
      expect(tasks[0].next_action).toBe('send_material');
    });

    it('已加微（终态，交给转化引擎） → 不生成任务', () => {
      const tasks = generateDailyTasks([mkLead({ status: '已加微' })], { profile, conversion });
      expect(tasks).toHaveLength(0);
    });

    it('已成交（终态）→ 不生成任务', () => {
      const tasks = generateDailyTasks([mkLead({ status: '已成交' })], { profile, conversion });
      expect(tasks).toHaveLength(0);
    });
  });

  describe('§3.6.2 互动感知', () => {
    it('被拒 → 立即降级为已流失', () => {
      const lead = mkLead({
        last_task_executed_at: new Date().toISOString(),
        last_task_result: '被拒',
        execution_count: 1,
      });
      const tasks = generateDailyTasks([lead], { profile, conversion });
      expect(lead.status).toBe('已流失');
      expect(tasks).toHaveLength(0);
    });

    it('3 次 0 回应 → 标记流失', () => {
      const lead = mkLead({
        last_task_executed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        last_task_result: '无回应',
        execution_count: 3,
        response_count: 0,
      });
      const tasks = generateDailyTasks([lead], { profile, conversion });
      expect(lead.status).toBe('已流失');
      expect(tasks).toHaveLength(0);
    });

    it('回复含中文拒绝词（别发了）→ opt_out=true + status=已流失', () => {
      // F11 验证：applyInteractionFeedback 必须触发 checkAbandonment 中的 opt_out 分支
      const lead = mkLead({
        last_task_executed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        last_task_result: '有回应',
        execution_count: 1,
        response_count: 1,
        last_response_text: '别发了别再打扰我了',
      });
      const tasks = generateDailyTasks([lead], { profile, conversion });
      expect(lead.opt_out).toBe(true);
      expect(lead.status).toBe('已流失');
      expect(tasks).toHaveLength(0);
    });

    it('回复含英文拒绝词（stop）→ status=已流失', () => {
      // F11 验证：英文拒绝词同样触发
      const lead = mkLead({
        last_task_executed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        last_task_result: '有回应',
        execution_count: 1,
        response_count: 1,
        last_response_text: 'stop please',
      });
      const tasks = generateDailyTasks([lead], { profile, conversion });
      expect(lead.opt_out).toBe(true);
      expect(lead.status).toBe('已流失');
      expect(tasks).toHaveLength(0);
    });

    it('正常回复（无拒绝词）→ opt_out 保持 false', () => {
      // F11 验证：良性回复不会被误判
      const lead = mkLead({
        last_task_executed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        last_task_result: '有回应',
        execution_count: 1,
        response_count: 1,
        last_response_text: '好的谢谢，我考虑一下',
      });
      generateDailyTasks([lead], { profile, conversion });
      expect(lead.opt_out).toBeFalsy();
      expect(lead.status).not.toBe('已流失');
    });

    it('任务间隔 < 24h → 跳过', () => {
      const lead = mkLead({
        last_task_executed_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),  // 1h 前
        last_task_result: '有回应',
        execution_count: 1,
      });
      const tasks = generateDailyTasks([lead], { profile, conversion });
      expect(tasks).toHaveLength(0);
    });
  });

  describe('§3.6.3 智能放弃', () => {
    it('沉默 > 30 天 → 进沉默池', () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      const lead = mkLead({
        status: '已加微',
        wechat_added_at: oldDate,
        last_interaction_at: oldDate,
      });
      generateDailyTasks([lead], { profile, conversion });
      expect(lead.status).toBe('沉默');
    });
  });

  describe('§3.6.4 再激活', () => {
    it('findReactivatableLeads 只返回沉默状态', () => {
      const leads = [
        mkLead({ cid: '1', status: '新发现' }),
        mkLead({ cid: '2', status: '沉默', last_interaction_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() }),
        mkLead({ cid: '3', status: '已流失' }),
      ];
      const r = findReactivatableLeads(leads);
      expect(r.map(l => l.cid)).toEqual(['2']);
    });

    it('reactivate 生成 dm 任务', () => {
      const task = reactivate(mkLead({ status: '沉默' }));
      expect(task.next_action).toBe('dm');
      expect(task.priority).toBe('low');
    });
  });

  describe('优先级排序', () => {
    it('高价值 persona 优先', () => {
      const leads = [
        mkLead({ cid: '1', persona: 'ecommerce' }),  // value_score 4
        mkLead({ cid: '2', persona: 'self_media' }),  // value_score 9
      ];
      const tasks = generateDailyTasks(leads, { profile, conversion });
      expect(tasks[0].lead_cid).toBe('2');
    });
  });

  describe('任务数限制', () => {
    it('limit = 5 → 最多 5 个任务', () => {
      const leads = Array.from({ length: 10 }, (_, i) => mkLead({ cid: `c${i}` }));
      const tasks = generateDailyTasks(leads, { profile, conversion, dailyTaskLimit: 5 });
      expect(tasks).toHaveLength(5);
    });
  });
});
