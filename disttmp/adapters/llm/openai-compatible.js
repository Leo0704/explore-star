/**
 * OpenAI 兼容 LLM Provider
 *
 * 同时实现 OpenAI 和 DeepSeek（两者都是 OpenAI 兼容 API）。
 * V1.4 默认 DeepSeek（国内直连 + 便宜），可降级到 OpenAI/Anthropic/Ollama。
 */
export class OpenAICompatibleLLM {
    opts;
    capabilities = {
        jsonMode: true,
        functionCalling: true,
        vision: false,
        contextWindow: 128_000,
    };
    pricing;
    constructor(opts) {
        if (!opts.apiKey)
            throw new Error('OpenAICompatibleLLM 需要 apiKey');
        this.opts = {
            apiKey: opts.apiKey,
            baseUrl: opts.baseUrl || (opts.model.startsWith('deepseek') ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1'),
            model: opts.model,
        };
        this.pricing = {
            inputPerMTok: opts.pricing?.inputPerMTok ?? 0.15,
            outputPerMTok: opts.pricing?.outputPerMTok ?? 0.6,
            embedPerMTok: opts.pricing?.embedPerMTok ?? 0.02,
        };
    }
    async complete(prompt, opts = {}) {
        const body = {
            model: this.opts.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: opts.temperature ?? 0.3,
            max_tokens: opts.maxTokens ?? 1000,
        };
        if (opts.responseFormat === 'json') {
            body.response_format = { type: 'json_object' };
        }
        if (opts.stop)
            body.stop = opts.stop;
        const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.opts.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`LLM API ${res.status}: ${errText.slice(0, 500)}`);
        }
        const json = await res.json();
        return json.choices?.[0]?.message?.content ?? '';
    }
    async embed(text) {
        const res = await fetch(`${this.opts.baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.opts.apiKey}`,
            },
            body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
        });
        if (!res.ok)
            throw new Error(`Embed API ${res.status}`);
        const json = await res.json();
        return json.data[0].embedding;
    }
    async ping() {
        const t0 = Date.now();
        try {
            await this.complete('ping', { maxTokens: 5 });
            return { ok: true, latency_ms: Date.now() - t0 };
        }
        catch (e) {
            return { ok: false, latency_ms: Date.now() - t0 };
        }
    }
}
//# sourceMappingURL=openai-compatible.js.map