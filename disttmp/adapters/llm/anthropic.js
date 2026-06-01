/**
 * Anthropic LLM Provider（实现 LLMProvider，Anthropic Messages API）
 *
 * 依赖：ANTHROPIC_API_KEY 环境变量
 * 模型：claude-3-5-sonnet-20241022（默认）
 */
export class AnthropicLLM {
    apiKey;
    capabilities = {
        jsonMode: true,
        functionCalling: true,
        vision: true,
        contextWindow: 200_000,
    };
    pricing = {
        inputPerMTok: 3.0, // claude-3-5-sonnet
        outputPerMTok: 15.0,
        embedPerMTok: 0,
    };
    constructor(apiKey = process.env.ANTHROPIC_API_KEY ?? '') {
        this.apiKey = apiKey;
        if (!this.apiKey)
            throw new Error('AnthropicLLM 需要 ANTHROPIC_API_KEY 环境变量');
    }
    async complete(prompt, opts = {}) {
        const body = {
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: opts.maxTokens ?? 1000,
            messages: [{ role: 'user', content: prompt }],
        };
        if (opts.temperature !== undefined)
            body.temperature = opts.temperature;
        if (opts.stop)
            body.stop_sequences = opts.stop;
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 500)}`);
        }
        const json = await res.json();
        const textContent = json.content?.find(c => c.type === 'text');
        return textContent?.text ?? '';
    }
    async embed(_text) {
        // Anthropic 目前没有 embedding 接口，降级到 0 向量
        return Array(1536).fill(0);
    }
    async ping() {
        const t0 = Date.now();
        try {
            await this.complete('ping', { maxTokens: 5 });
            return { ok: true, latency_ms: Date.now() - t0 };
        }
        catch {
            return { ok: false, latency_ms: Date.now() - t0 };
        }
    }
}
//# sourceMappingURL=anthropic.js.map