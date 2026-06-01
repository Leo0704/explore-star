/**
 * Prompt 模板加载器
 *
 * 从 business.example/燃点-FDE/prompts/ 目录加载 Handlebars 模板，
 * 支持 {{ business.name }} / {{#each target_personas}} 等变量注入。
 */
export interface PromptTemplates {
    intentSystem: string;
    intentUser: string;
    hookReply: string;
    hookDm: string;
}
/**
 * 加载所有 prompt 模板
 */
export declare function loadPromptTemplates(promptsDir: string): Promise<PromptTemplates>;
/**
 * 预编译 intent-system prompt（注入业务画像）
 */
export declare function compileIntentSystemPrompt(template: string, ctx: {
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
        buying_stages?: Array<{
            id: string;
            name: string;
            description: string;
        }>;
    };
}): string;
/**
 * 预编译 intent-user prompt（注入单条评论上下文）
 */
export declare function compileIntentUserPrompt(template: string, ctx: {
    video_desc: string;
    video_url: string;
    nickname: string;
    user_signature: string;
    follower_count: number;
    comment_text: string;
}): string;
/**
 * 预编译 hook prompt
 */
export declare function compileHookPrompt(template: string, ctx: {
    business: {
        name: string;
    };
    lead: string;
    knowledge_docs: string;
    hook_config: {
        max_length: number;
        style: string;
        language: string;
    };
}): string;
