/**
 * prompts-loader learned_* 变量扩展测试（Phase 2 #3）
 *
 * 覆盖：
 *   - compileIntentSystemPrompt 接受 IntentSystemContext（含 learned_*）
 *   - learned_* 缺省 → 空数组 → {{#if}} 块不展开（不报错）
 *   - learned_* 提供 → {{#each}} 正确渲染
 */

import { describe, it, expect } from 'vitest';
import { compileIntentSystemPrompt } from '../../../src/modules/intent-analyzer/prompts-loader.js';
import type { IntentSystemContext } from '../../../src/modules/intent-analyzer/prompts-loader.js';

describe('compileIntentSystemPrompt (learned_* extension)', () => {
  const baseCtx: IntentSystemContext = {
    business: {
      name: 'B',
      value_prop: 'V',
      target_personas: [],
      intent_signals: [],
    },
  };

  it('does not throw when learned_* omitted (no error)', () => {
    const tpl = `{{#if learned_negative_examples.length}}NEG{{/if}}{{#if learned_positive_patterns.length}}POS{{/if}}`;
    const r = compileIntentSystemPrompt(tpl, baseCtx);
    expect(r).toBe('');
  });

  it('renders negative examples when provided', () => {
    const tpl = `{{#each learned_negative_examples}}{{this.comment_snippet}};{{/each}}`;
    const ctx: IntentSystemContext = {
      ...baseCtx,
      learned_negative_examples: [
        { comment_snippet: 'foo' },
        { comment_snippet: 'bar' },
      ],
      learned_positive_patterns: [],
    };
    const r = compileIntentSystemPrompt(tpl, ctx);
    expect(r).toBe('foo;bar;');
  });

  it('renders positive patterns when provided', () => {
    const tpl = `{{#each learned_positive_patterns}}{{this.persona_id}}=>{{this.outcome}};{{/each}}`;
    const ctx: IntentSystemContext = {
      ...baseCtx,
      learned_negative_examples: [],
      learned_positive_patterns: [
        { persona_id: 'p1', outcome: 'converted' },
        { persona_id: 'p2', outcome: 'converted' },
      ],
    };
    const r = compileIntentSystemPrompt(tpl, ctx);
    expect(r).toBe('p1=>converted;p2=>converted;');
  });

  it('empty arrays render as nothing (no error)', () => {
    const tpl = `A{{#each learned_negative_examples}}X{{/each}}B`;
    const ctx: IntentSystemContext = {
      ...baseCtx,
      learned_negative_examples: [],
      learned_positive_patterns: [],
    };
    const r = compileIntentSystemPrompt(tpl, ctx);
    expect(r).toBe('AB');
  });
});
