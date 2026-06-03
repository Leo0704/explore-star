import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LeadEvent } from '../../core/types.js';

export interface EventRecorderOptions {
  eventsPath?: string;
}

const DEFAULT_EVENTS_PATH = './data/feedback/events.jsonl';

export async function recordEvent(
  event: LeadEvent,
  opts: EventRecorderOptions = {},
): Promise<void> {
  const path = opts.eventsPath ?? DEFAULT_EVENTS_PATH;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(event) + '\n', 'utf-8');
}

export async function recordStatusChange(
  cid: string,
  fromStatus: string | null,
  toStatus: string,
  metadata: {
    keyword: string;
    hook_style: string;
    hook_text: string;
    persona: string;
    interaction_time: string;
    days_to_convert?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const event: LeadEvent = {
    event: 'lead_status_changed',
    cid,
    from_status: fromStatus as any,
    to_status: toStatus as any,
    ...metadata,
  };
  await recordEvent(event);
}

export async function recordTaskExecuted(
  cid: string,
  metadata: {
    keyword: string;
    hook_style: string;
    hook_text: string;
    persona: string;
    interaction_time: string;
  },
): Promise<void> {
  const event: LeadEvent = {
    event: 'task_executed',
    cid,
    ...metadata,
  };
  await recordEvent(event);
}