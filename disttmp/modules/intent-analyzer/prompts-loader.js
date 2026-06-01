/**
 * Prompt 模板加载器
 *
 * 从 business.example/燃点-FDE/prompts/ 目录加载 Handlebars 模板，
 * 支持 {{ business.name }} / {{#each target_personas}} 等变量注入。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Handlebars from 'handlebars';
/**
 * 加载所有 prompt 模板
 */
export async function loadPromptTemplates(promptsDir) {
    const [intentSystem, intentUser, hookReply, hookDm] = await Promise.all([
        readFile(join(promptsDir, 'intent-system.md'), 'utf-8'),
        readFile(join(promptsDir, 'intent-user.md'), 'utf-8'),
        readFile(join(promptsDir, 'hook-reply.md'), 'utf-8'),
        readFile(join(promptsDir, 'hook-dm.md'), 'utf-8'),
    ]);
    return { intentSystem, intentUser, hookReply, hookDm };
}
/**
 * 预编译 intent-system prompt（注入业务画像）
 */
export function compileIntentSystemPrompt(template, ctx) {
    return Handlebars.compile(template)(ctx);
}
/**
 * 预编译 intent-user prompt（注入单条评论上下文）
 */
export function compileIntentUserPrompt(template, ctx) {
    return Handlebars.compile(template)(ctx);
}
/**
 * 预编译 hook prompt
 */
export function compileHookPrompt(template, ctx) {
    return Handlebars.compile(template)(ctx);
}
//# sourceMappingURL=prompts-loader.js.map