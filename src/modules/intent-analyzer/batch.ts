/**
 * 批处理器（10 条/批）
 *
 * analyzeComments 的实际批处理逻辑，暴露给编排器直接调用。
 */

import Handlebars from 'handlebars';

import type { Comment, Lead, BusinessProfile } from '../../core/types.js';

export interface BatchContext {
  profile: BusinessProfile;
  systemPrompt: string;
  userTplStr: string;
  llm: { complete(prompt: string): Promise<string> };
  threshold: number;
}

export type BatchRejectedItem = { cid: string; reason: string; raw?: string };

/**
 * 分析一批评论（10 条）
 */
export async function analyzeBatch(
  comments: Comment[],
  ctx: BatchContext,
): Promise<{
  leads: Lead[];
  rejected: BatchRejectedItem[];
  llmErrors: number;
}> {
  const { profile, systemPrompt, userTplStr, llm, threshold } = ctx;

  // 渲染 user prompt（Handlebars 注入每条评论字段）
  const userTpl = Handlebars.compile(userTplStr);
  const userPrompt = userTpl({
    // 注入评论列表上下文
    comments: comments.map(c => ({
      video_desc: c.video_desc,
      video_url: c.video_url,
      nickname: c.user.nickname,
      user_signature: c.user.signature,
      follower_count: c.user.follower_count,
      comment_text: c.text,
    })),
  });

  let llmErrors = 0;
  let rawOutput = '';

  try {
    rawOutput = await llm.complete(`${systemPrompt}\n\n${userPrompt}\n\n【输出 JSON 数组】`);
  } catch (e) {
    llmErrors++;
    return {
      leads: [],
      rejected: comments.map(c => ({ cid: c.cid, reason: `LLM 调用失败: ${e}` })),
      llmErrors,
    };
  }

  // 解析 JSON 数组
  const parsed = parseJsonArraySafe(rawOutput);
  if (!parsed) {
    llmErrors++;
    return {
      leads: [],
      rejected: comments.map(c => ({ cid: c.cid, reason: 'LLM 输出无法解析', raw: rawOutput })),
      llmErrors,
    };
  }

  const now = new Date().toISOString();
  const leads: Lead[] = [];
  const rejected: BatchRejectedItem[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as {
      is_target_persona: boolean;
      persona: string;
      pain_point: string;
      intent_score: number;
      buying_stage: string;
      suggested_reply_hook: string;
      suggested_dm_hook: string;
    };
    const comment = comments[i];
    if (!comment) continue;

    // 过滤 intent_score 阈值
    if (typeof item.intent_score !== 'number' || item.intent_score < threshold) {
      rejected.push({
        cid: comment.cid,
        reason: `intent_score=${item.intent_score} 低于阈值 ${threshold}`,
      });
      continue;
    }

    // 过滤非目标人设
    if (!item.is_target_persona) {
      rejected.push({ cid: comment.cid, reason: '不是目标人设' });
      continue;
    }

    // 校验 persona ID 有效
    const validPersona = profile.target_personas.some(p => p.id === item.persona);
    if (!validPersona) {
      rejected.push({ cid: comment.cid, reason: `未知 persona: ${item.persona}` });
      continue;
    }

    leads.push(buildLead(comment, item, now));
  }

  return { leads, rejected, llmErrors };
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function buildLead(
  comment: Comment,
  analysis: {
    persona: string;
    pain_point: string;
    intent_score: number;
    buying_stage: string;
    suggested_reply_hook: string;
    suggested_dm_hook: string;
  },
  now: string,
): Lead {
  return {
    cid: comment.cid,
    source: 'douyin_user_videos',
    aweme_id: comment.aweme_id,
    video_url: comment.video_url,
    video_desc: comment.video_desc,
    keyword: comment.keyword,

    nickname: comment.user.nickname,
    user_signature: comment.user.signature,
    follower_count: comment.user.follower_count,
    user_uid: comment.user.uid,

    comment_text: comment.text,
    comment_digg_count: comment.digg_count,
    comment_create_time: new Date(Number(comment.create_time) * 1000).toISOString(),

    is_target_persona: true,
    persona: analysis.persona,
    pain_point: analysis.pain_point,
    intent_score: analysis.intent_score,
    buying_stage: analysis.buying_stage,
    suggested_reply_hook: analysis.suggested_reply_hook,
    suggested_dm_hook: analysis.suggested_dm_hook,

    status: '新发现',
    status_history: [{ from: null, to: '新发现', at: now, note: `由 ${comment.keyword} 触发` }],

    execution_count: 0,
    response_count: 0,

    created_at: now,
    updated_at: now,
  };
}

function parseJsonArraySafe(raw: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as unknown[];
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const arrKey = Object.keys(obj).find(k => Array.isArray(obj[k]));
      if (arrKey) return obj[arrKey] as unknown[];
    }
    return null;
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        return JSON.parse(m[0]) as unknown[];
      } catch {
        return null;
      }
    }
    return null;
  }
}