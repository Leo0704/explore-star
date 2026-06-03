import { readFile, writeFile } from 'node:fs/promises';
import YAML from 'yaml';
import { logger } from '../../core/logger.js';

export interface PersonaValueUpdate {
  id: string;
  value_score: number;
  sample_size: number;
  updated_at: string;
}

export interface UpdateOptions {
  channelsPath: string;
  updates: PersonaValueUpdate[];
}

export interface UpdateResult {
  written: number;
  skipped?: 'file_missing' | 'parse_failed' | 'write_failed' | 'invalid_personas_section';
}

export async function updatePersonaValueScores(opts: UpdateOptions): Promise<UpdateResult> {
  let raw: string;
  try {
    raw = await readFile(opts.channelsPath, 'utf-8');
  } catch {
    logger.warn({ channelsPath: opts.channelsPath }, 'channels.yaml 不存在，跳过 personas 写回');
    return { written: 0, skipped: 'file_missing' };
  }

  let config: any;
  try {
    config = YAML.parse(raw);
  } catch (e) {
    logger.warn({ err: e, channelsPath: opts.channelsPath }, 'channels.yaml 解析失败，跳过 personas 写回');
    return { written: 0, skipped: 'parse_failed' };
  }

  if (!config.personas) config.personas = [];
  if (!Array.isArray(config.personas)) {
    logger.warn({ channelsPath: opts.channelsPath }, 'channels.yaml personas 段不是数组，跳过');
    return { written: 0, skipped: 'invalid_personas_section' };
  }

  const byId = new Map<string, any>(config.personas.map((p: any) => [p.id, p]));
  let written = 0;
  for (const u of opts.updates) {
    const existing = byId.get(u.id);
    if (existing) {
      existing.value_score = u.value_score;
      existing.sample_size = u.sample_size;
      existing.last_updated = u.updated_at;
    } else {
      config.personas.push({
        id: u.id,
        value_score: u.value_score,
        sample_size: u.sample_size,
        last_updated: u.updated_at,
      });
    }
    written++;
  }

  try {
    await writeFile(opts.channelsPath, YAML.stringify(config), 'utf-8');
  } catch (e) {
    logger.warn({ err: e }, 'channels.yaml 写回失败');
    return { written: 0, skipped: 'write_failed' };
  }
  return { written };
}

export async function readOldPersonaScores(channelsPath: string): Promise<Map<string, number>> {
  try {
    const raw = await readFile(channelsPath, 'utf-8');
    const cfg = YAML.parse(raw);
    const map = new Map<string, number>();
    for (const p of cfg?.personas ?? []) {
      if (p?.id && typeof p.value_score === 'number') map.set(p.id, p.value_score);
    }
    return map;
  } catch {
    return new Map();
  }
}
