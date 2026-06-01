/**
 * 营销号过滤器
 *
 * 基于 nickname / signature 关键词启发式排除营销号。
 * 不做 ML，不依赖 LLM，速度优先。
 */
export interface MarketingFilterResult {
    isMarketing: boolean;
    matchedPatterns: string[];
}
/**
 * 判断评论者是否是营销号
 */
export declare function isMarketingAccount(nickname: string, signature: string): MarketingFilterResult;
/**
 * 过滤一组评论中的营销号
 */
export declare function filterMarketingComments<T extends {
    user: {
        nickname: string;
        signature: string;
    };
}>(comments: T[]): {
    kept: T[];
    filtered: Array<{
        comment: T;
        reason: string;
    }>;
};
