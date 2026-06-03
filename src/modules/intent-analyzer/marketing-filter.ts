const MARKETING_NICKNAME_PATTERNS = [
  /客服|小助手|助理|sales|sale|经理|顾问/i,
  /^A\d+$/i,
  /\d{4,}$/,
  /免费|领取|加微|私信|代购/i,
];

const MARKETING_SIGNATURE_PATTERNS = [
  /代购|代理|招商|加盟|批发|一件代发/i,
  /加我微信|加微|私信|ATT|@/,
  /收徒|教学|课程|培训/i,
  /低价|优惠|折扣|秒杀/i,
  /量大从优|工厂直供|源头厂家/i,
];

export interface MarketingFilterResult {
  isMarketing: boolean;
  matchedPatterns: string[];
}

export function isMarketingAccount(
  nickname: string,
  signature: string,
): MarketingFilterResult {
  const matchedPatterns: string[] = [];

  for (const pattern of MARKETING_NICKNAME_PATTERNS) {
    if (pattern.test(nickname)) {
      matchedPatterns.push(`nickname: ${pattern}`);
    }
  }

  for (const pattern of MARKETING_SIGNATURE_PATTERNS) {
    if (pattern.test(signature)) {
      matchedPatterns.push(`signature: ${pattern}`);
    }
  }

  return {
    isMarketing: matchedPatterns.length > 0,
    matchedPatterns,
  };
}

export function filterMarketingComments<T extends { user: { nickname: string; signature: string } }>(
  comments: T[],
): { kept: T[]; filtered: Array<{ comment: T; reason: string }> } {
  const kept: T[] = [];
  const filtered: Array<{ comment: T; reason: string }> = [];

  for (const comment of comments) {
    const { nickname, signature } = comment.user;
    const result = isMarketingAccount(nickname, signature);
    if (result.isMarketing) {
      filtered.push({
        comment,
        reason: `营销号匹配: ${result.matchedPatterns.join(', ')}`,
      });
    } else {
      kept.push(comment);
    }
  }

  return { kept, filtered };
}