/**
 * Ollama LLM Provider（实现 LLMProvider，Ollama /api/chat）
 *
 * 依赖：OLLAMA_BASE_URL 环境变量（默认 http://localhost:11434）
 * 模型：qwen2.5（默认）
 * 本地免费，适合开发/测试
 */
export class OllamaLLM {
    baseUrl;
    model;
    capabilities = {
        jsonMode: true,
        functionCalling: false,
        vision: false,
        contextWindow: 128_000,
    };
    pricing = {
        inputPerMTok: 0,
        outputPerMTok: 0,
        embedPerMTok: 0,
    };
    constructor(baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434', model = process.env.OLLAMA_MODEL ?? 'qwen2.5') {
        this.baseUrl = baseUrl;
        this.model = model;
    }
    async complete(prompt, opts = {}) {
        const body = {
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
        };
        if (opts.temperature !== undefined)
            body.temperature = opts.temperature;
        if (opts.maxTokens)
            body.options = { num_predict: opts.maxTokens };
        if (opts.stop)
            body.options = { ...body.options, stop: opts.stop };
        const res = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Ollama API ${res.status}: ${errText.slice(0, 500)}`);
        }
        const json = await res.json();
        return json.message?.content ?? '';
    }
    async embed(text) {
        const res = await fetch(`${this.baseUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: this.model, prompt: text }),
        });
        if (!res.ok)
            throw new Error(`Ollama embed API ${res.status}`);
        const json = await res.json();
        return json.embedding ?? [];
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
//# sourceMappingURL=ollama.js.map