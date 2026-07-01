const BASE = '';

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`无法连接到后端 API（${path}）：${detail}。请检查 \`npm run web\` 是否启动（默认端口 3827）。`);
  }
  if (!res.ok) throw new Error(`API ${path}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Shared types — re-exported from src/core/types.ts (single source of truth).
// Vite alias `@shared` → repo root `src/`. tsconfig paths mirrors it.
// If the backend type diverges from frontend usage, both sides compile-fail
// here instead of silently rendering undefined at runtime.
// ---------------------------------------------------------------------------

import type {
  Task,
  TaskAction,
  KeywordPerformance,
  HookStylePerformance,
  PersonaValue,
  BestInteractionTimes as BestInteractionTime,
  WeeklyInsights,
  LeadEvent,
} from '@shared/types';

export type {
  Task,
  TaskAction,
  KeywordPerformance,
  HookStylePerformance,
  PersonaValue,
  BestInteractionTime,
  WeeklyInsights,
  LeadEvent,
};

// ---------------------------------------------------------------------------
// Frontend-only types: orchestration shapes that the backend exposes via
// server.ts handlers. These live in orchestration/*.ts which import Node-only
// modules (proper-lockfile / pino / node:fs), so we mirror them here.
// Keep in sync when src/orchestration/{state,run-history,health-check}.ts
// change field names or types.
// ---------------------------------------------------------------------------

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface StepState {
  name: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

export interface PipelineState {
  date: string;
  currentStep: number;
  steps: StepState[];
  startedAt: string;
  lastUpdatedAt: string;
  errors: string[];
  completed: boolean;
}

export interface RunHistoryEntry {
  run_id: string;
  business: string;
  mode: 'full' | 'read-only';
  dry_run: boolean;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  exit_reason: 'completed' | 'failed' | 'login_required' | 'browser_escalated' | 'cancelled';
  step_durations: Record<string, number>;
  phase_counts: {
    videos_scanned: number;
    comments_collected: number;
    leads_created: number;
    tasks_generated: number;
    tasks_executed: number;
  };
  errors: string[];
  cost_estimate?: {
    prompt_tokens: number;
    completion_tokens: number;
    estimated_cost_usd: number;
  };
}

export interface RunHistoryStats {
  stats: {
    totalRuns: number;
    failedRuns: number;
    avgDurationMs: number;
    topErrors: Array<{ message: string; count: number }>;
  };
  avgStepDurations: Record<string, number>;
  cost: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCostUsd: number;
  };
}

export type HealthStatus = 'ok' | 'warning' | 'critical' | 'error';

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface HealthResult {
  status: HealthStatus;
  checks: HealthCheck[];
  summary: string;
}

export interface LearnedExamples {
  learned_positive_patterns: Array<{
    persona_id: string;
    comment_snippet: string;
    pain_point: string;
    outcome: string;
    days_to_outcome: number;
  }>;
  learned_negative_examples: unknown[];
  generated_at: string;
}

export interface DlqEntry {
  archived_at: string;
  report: {
    total: number;
    synced: number;
    failed: number;
    errors: Array<{ cid: string; error: string }>;
  };
  leads: Array<Record<string, unknown>>;
}

export interface BusinessConfig {
  name: string;
  profile: Record<string, unknown> | null;
  channels: Record<string, unknown> | null;
  conversion: Record<string, unknown> | null;
  crm: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export const api = {
  getState:           () => get<PipelineState>('/api/state'),
  getRunHistory:      (days = 30) => get<{ entries: RunHistoryEntry[]; days: number }>(`/api/run-history?days=${days}`),
  getRunHistoryStats: (days = 30) => get<RunHistoryStats>(`/api/run-history/stats?days=${days}`),
  getHealth:          () => get<HealthResult>('/api/health'),
  getInsights:        () => get<WeeklyInsights | null>('/api/feedback/insights'),
  getEvents:          () => get<LeadEvent[]>('/api/feedback/events'),
  getLearned:         () => get<LearnedExamples | null>('/api/feedback/learned'),
  getLeads:           () => get<{ source: string; leads: unknown[] }>('/api/leads'),
  getDlq:             () => get<DlqEntry[]>('/api/dlq'),
  getConfig:          () => get<{ businesses: BusinessConfig[] }>('/api/config'),
  getTasks:           () => get<{ date: string; tasks: Task[] }>('/api/tasks'),
};
