/**
 * Persona 价值归因（§3.11 回路 3：persona 价值排序）
 *
 * V1.4 实现：
 *   - 从 events.jsonl 聚合各 persona 的 leads / conversions / revenue
 *   - 计算 value_score（0-10）
 *   - 输出 PersonaValue[]
 */
import type { LeadEvent, PersonaValue } from '../../core/types.js';
export interface PersonaValueResult {
    values: PersonaValue[];
    ranking: Array<{
        persona: string;
        value_score: number;
    }>;
}
/**
 * 计算各 persona 的价值评分
 */
export declare function computePersonaValue(events: LeadEvent[]): PersonaValueResult;
