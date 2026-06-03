import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { updatePersonaValueScores, readOldPersonaScores } from '../../../src/modules/feedback-applier/channels-writer.js';
import type { PersonaValueUpdate } from '../../../src/modules/feedback-applier/channels-writer.js';

describe('channels-writer', () => {
  let tmpDir: string;
  const channelsPath = () => join(tmpDir, 'channels.yaml');

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `channels-writer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(tmpDir, { recursive: true });
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  const baseYaml = `source:
  mode: "keyword"

search:
  keywords:
    "AI": 1.0

filters:
  min_likes: 100
`;

  it('creates personas section when missing', async () => {
    await writeFile(channelsPath(), baseYaml);
    const updates: PersonaValueUpdate[] = [{
      id: 'p1', value_score: 7.5, sample_size: 10, updated_at: '2026-06-03T00:00:00Z',
    }];
    const r = await updatePersonaValueScores({ channelsPath: channelsPath(), updates });
    expect(r.written).toBe(1);

    const parsed = YAML.parse(await readFile(channelsPath(), 'utf-8'));
    expect(parsed.personas).toHaveLength(1);
    expect(parsed.personas[0]).toMatchObject({ id: 'p1', value_score: 7.5, sample_size: 10 });
    expect(parsed.search.keywords).toEqual({ AI: 1.0 });
  });

  it('updates existing persona in place (preserves other fields)', async () => {
    const yaml = baseYaml + `\npersonas:\n  - id: p1\n    name: "First"\n    value_score: 5.0\n`;
    await writeFile(channelsPath(), yaml);
    const updates: PersonaValueUpdate[] = [{
      id: 'p1', value_score: 8.0, sample_size: 20, updated_at: '2026-06-03T00:00:00Z',
    }];
    await updatePersonaValueScores({ channelsPath: channelsPath(), updates });
    const parsed = YAML.parse(await readFile(channelsPath(), 'utf-8'));
    expect(parsed.personas[0]).toMatchObject({ id: 'p1', value_score: 8.0, sample_size: 20, name: 'First' });
  });

  it('appends new persona (existing kept)', async () => {
    const yaml = baseYaml + `\npersonas:\n  - id: p1\n    value_score: 5.0\n`;
    await writeFile(channelsPath(), yaml);
    const updates: PersonaValueUpdate[] = [
      { id: 'p1', value_score: 5.0, sample_size: 5, updated_at: '2026-06-03T00:00:00Z' },
      { id: 'p2', value_score: 6.0, sample_size: 8, updated_at: '2026-06-03T00:00:00Z' },
    ];
    await updatePersonaValueScores({ channelsPath: channelsPath(), updates });
    const parsed = YAML.parse(await readFile(channelsPath(), 'utf-8'));
    expect(parsed.personas).toHaveLength(2);
  });

  it('silently skips when channels.yaml does not exist', async () => {
    const r = await updatePersonaValueScores({
      channelsPath: channelsPath(),
      updates: [{ id: 'p1', value_score: 5, sample_size: 1, updated_at: '2026-06-03T00:00:00Z' }],
    });
    expect(r.written).toBe(0);
    expect(r.skipped).toBe('file_missing');
  });

  it('readOldPersonaScores returns existing scores', async () => {
    const yaml = baseYaml + `\npersonas:\n  - id: p1\n    value_score: 6.5\n  - id: p2\n    value_score: 4.2\n`;
    await writeFile(channelsPath(), yaml);
    const map = await readOldPersonaScores(channelsPath());
    expect(map.get('p1')).toBe(6.5);
    expect(map.get('p2')).toBe(4.2);
  });

  it('readOldPersonaScores returns empty map on missing file', async () => {
    const map = await readOldPersonaScores(channelsPath());
    expect(map.size).toBe(0);
  });
});
