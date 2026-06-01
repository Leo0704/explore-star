/**
 * OpenAI Embedding Provider（V1.4 独立实现）
 *
 * 不复用 LLM 抽象（embeddings 有不同的 input/response 形状）
 */
export class OpenAIEmbedding {
    dimensions;
    model;
    apiKey;
    baseUrl;
    constructor(opts) {
        this.apiKey = opts.apiKey;
        this.baseUrl = opts.baseUrl || 'https://api.openai.com/v1';
        this.model = opts.model || 'text-embedding-3-small';
        this.dimensions = this.model === 'text-embedding-3-small' ? 1536 : 1536;
    }
    async embed(text) {
        const result = await this.embedBatch([text]);
        return result[0];
    }
    async embedBatch(texts) {
        const res = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model: this.model, input: texts }),
        });
        if (!res.ok) {
            throw new Error(`OpenAI Embeddings API ${res.status}: ${await res.text()}`);
        }
        const json = (await res.json());
        return json.data.map(d => d.embedding);
    }
}
//# sourceMappingURL=openai.js.map