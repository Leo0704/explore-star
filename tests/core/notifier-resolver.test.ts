import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BusinessProfile, Notifier } from '../../src/core/types.js';

const mockRegistry: Record<string, Notifier> = {};

vi.mock('../../src/adapters/registry.js', () => ({
  getNotifier: (name: string) => {
    const n = mockRegistry[name];
    if (!n) throw new Error(`Notifier "${name}" 未注册`);
    return n;
  },
}));

import { resolveNotifiers } from '../../src/core/notifier-resolver.js';

function makeNotifier(name: string): Notifier {
  return { name, send: vi.fn().mockResolvedValue({ ok: true }) };
}

function makeProfile(overrides: Partial<BusinessProfile['observability']> = {}): BusinessProfile {
  return {
    business: { name: 'test', value_prop: 'x' },
    target_personas: [{ id: 'p1', name: 'P1', typical_pain_points: ['x'] }],
    intent_signals: ['x'],
    llm: { provider: 'deepseek', model: 'd', api_key_env: 'X' },
    crm: { type: 'csv', config: {} },
    observability: overrides as any,
  };
}

beforeEach(() => {
  for (const k of Object.keys(mockRegistry)) delete mockRegistry[k];
  mockRegistry.console = makeNotifier('console');
  mockRegistry.feishu = makeNotifier('feishu');
});

describe('resolveNotifiers', () => {
  it('defaults to [console] when observability is undefined', () => {
    const result = resolveNotifiers(makeProfile(undefined));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('console');
  });

  it('defaults to [console] when notifier.channels is undefined', () => {
    const result = resolveNotifiers(makeProfile({ notifier: { enabled: true } }));
    expect(result.map(n => n.name)).toEqual(['console']);
  });

  it('respects configured channels', () => {
    const result = resolveNotifiers(makeProfile({ notifier: { channels: ['console', 'feishu'] } }));
    expect(result.map(n => n.name)).toEqual(['console', 'feishu']);
  });

  it('skips unregistered channel with warn (does not throw)', () => {
    const result = resolveNotifiers(makeProfile({ notifier: { channels: ['nonexistent', 'console'] } }));
    expect(result.map(n => n.name)).toEqual(['console']);
  });

  it('falls back to [console] when ALL configured channels fail', () => {
    const result = resolveNotifiers(makeProfile({ notifier: { channels: ['nonexistent'] } }));
    expect(result.map(n => n.name)).toEqual(['console']);
  });

  it('throws when channels is empty array (explicit user error)', () => {
    expect(() => resolveNotifiers(makeProfile({ notifier: { channels: [] } }))).toThrow(/至少配置 1 个/);
  });

  it('returns [] when notifier.enabled is false', () => {
    const result = resolveNotifiers(makeProfile({ notifier: { enabled: false, channels: ['console'] } }));
    expect(result).toEqual([]);
  });
});
