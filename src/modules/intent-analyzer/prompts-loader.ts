import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Handlebars from 'handlebars';

export interface PromptTemplates {
  intentSystem: string;
  intentUser: string;
  hookReply: string;
  hookDm: string;
}

export async function loadPromptTemplates(promptsDir: string): Promise<PromptTemplates> {
  const [intentSystem, intentUser, hookReply, hookDm] = await Promise.all([
    readFile(join(promptsDir, 'intent-system.md'), 'utf-8'),
    readFile(join(promptsDir, 'intent-user.md'), 'utf-8'),
    readFile(join(promptsDir, 'hook-reply.md'), 'utf-8'),
    readFile(join(promptsDir, 'hook-dm.md'), 'utf-8'),
  ]);

  return { intentSystem, intentUser, hookReply, hookDm };
}

export function compileIntentSystemPrompt(
  template: string,
  ctx: {
    business: {
      name: string;
      value_prop: string;
      target_personas: Array<{
        id: string;
        name: string;
        description?: string;
        typical_pain_points: string[];
      }>;
      intent_signals: string[];
      buying_stages?: Array<{ id: string; name: string; description: string }>;
    };
  },
): string {
  return Handlebars.compile(template)(ctx);
}

export function compileHookPrompt(
  template: string,
  ctx: {
    business: { name: string };
    lead: string;
    knowledge_docs: string;
    hook_config: { max_length: number; style: string; language: string };
  },
): string {
  return Handlebars.compile(template)(ctx);
}