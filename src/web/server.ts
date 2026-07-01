/**
 * 探星 Web 仪表盘 API 服务器
 *
 * 纯 node:http 实现，零依赖。
 * 生产模式下同时 serve web/dist/ 静态文件。
 *
 * 启动: node dist/web/server.js
 * 端口: 3827 (可通过 PORT 环境变量覆盖)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadState } from '../orchestration/state.js';
import { readRunHistory, summaryStats } from '../orchestration/run-history.js';
import { checkAll } from '../orchestration/health-check.js';

const PORT = parseInt(process.env.PORT ?? '3827', 10);
const DATA_DIR = resolve('./data');
const BUSINESS_DIR = resolve('./business');
const WEB_DIST = resolve('./web/dist');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function errorResponse(res: ServerResponse, status: number, message: string): void {
  jsonResponse(res, status, { error: message });
}

async function readJsonFile<T = unknown>(filePath: string, fallback: T): Promise<T> {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function readJsonlFile(filePath: string): Promise<unknown[]> {
  try {
    if (!existsSync(filePath)) return [];
    const raw = await readFile(filePath, 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function globJsonFiles(dir: string, pattern?: string): Promise<unknown[]> {
  try {
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    const matched = pattern
      ? files.filter(f => f.startsWith(pattern) && f.endsWith('.json'))
      : files.filter(f => f.endsWith('.json'));
    const results = await Promise.all(
      matched.map(f => readJsonFile(join(dir, f), null))
    );
    return results.filter(Boolean);
  } catch {
    return [];
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

async function serveStaticFile(res: ServerResponse, filePath: string): Promise<boolean> {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API Handlers
// ---------------------------------------------------------------------------

async function handleGetState(res: ServerResponse): Promise<void> {
  try {
    const state = await loadState();
    jsonResponse(res, 200, state);
  } catch (e) {
    errorResponse(res, 500, `Failed to load state: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleRunHistory(res: ServerResponse, url: URL): Promise<void> {
  const days = parseInt(url.searchParams.get('days') ?? '30', 10);
  const historyPath = join(DATA_DIR, 'run_history.jsonl');
  try {
    const entries = await readRunHistory(historyPath, { sinceDays: days });
    jsonResponse(res, 200, { entries, days });
  } catch (e) {
    errorResponse(res, 500, `Failed to read run history: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleRunHistoryStats(res: ServerResponse, url: URL): Promise<void> {
  const days = parseInt(url.searchParams.get('days') ?? '30', 10);
  const historyPath = join(DATA_DIR, 'run_history.jsonl');
  try {
    const entries = await readRunHistory(historyPath, { sinceDays: days });
    const stats = summaryStats(entries);

    // Aggregate step durations across all runs
    const stepTotals: Record<string, { total: number; count: number }> = {};
    for (const entry of entries) {
      for (const [step, ms] of Object.entries(entry.step_durations)) {
        if (!stepTotals[step]) stepTotals[step] = { total: 0, count: 0 };
        stepTotals[step].total += ms;
        stepTotals[step].count += 1;
      }
    }
    const avgStepDurations: Record<string, number> = {};
    for (const [step, { total, count }] of Object.entries(stepTotals)) {
      avgStepDurations[step] = Math.round(total / count);
    }

    // Aggregate cost estimates
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCostUsd = 0;
    for (const entry of entries) {
      if (entry.cost_estimate) {
        totalPromptTokens += entry.cost_estimate.prompt_tokens;
        totalCompletionTokens += entry.cost_estimate.completion_tokens;
        totalCostUsd += entry.cost_estimate.estimated_cost_usd;
      }
    }

    jsonResponse(res, 200, {
      stats,
      avgStepDurations,
      cost: {
        totalPromptTokens,
        totalCompletionTokens,
        totalCostUsd,
      },
    });
  } catch (e) {
    errorResponse(res, 500, `Failed to compute stats: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleHealth(res: ServerResponse): Promise<void> {
  try {
    // Find first business dir if available
    let businessDir: string | undefined;
    if (existsSync(BUSINESS_DIR)) {
      const dirs = await readdir(BUSINESS_DIR);
      const valid = dirs.find(d => existsSync(join(BUSINESS_DIR, d, 'profile.yaml')));
      if (valid) businessDir = join(BUSINESS_DIR, valid);
    }
    const result = await checkAll(businessDir);
    jsonResponse(res, 200, result);
  } catch (e) {
    errorResponse(res, 500, `Health check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleFeedbackInsights(res: ServerResponse): Promise<void> {
  const data = await readJsonFile(join(DATA_DIR, 'feedback', 'weekly-insights.json'), null);
  jsonResponse(res, 200, data);
}

async function handleFeedbackEvents(res: ServerResponse): Promise<void> {
  const events = await readJsonlFile(join(DATA_DIR, 'feedback', 'events.jsonl'));
  jsonResponse(res, 200, events);
}

async function handleFeedbackLearned(res: ServerResponse): Promise<void> {
  const data = await readJsonFile(join(DATA_DIR, 'feedback', 'learned-examples.json'), null);
  jsonResponse(res, 200, data);
}

async function handleLeads(res: ServerResponse): Promise<void> {
  // Aggregate from DLQ files
  const dlqFiles = await globJsonFiles(join(DATA_DIR, 'failed'), 'crm-sync-');
  const leads = dlqFiles.flatMap((f: unknown) => {
    const entry = f as { leads?: unknown[] };
    return entry.leads ?? [];
  });
  jsonResponse(res, 200, { source: 'dlq', leads });
}

async function handleDlq(res: ServerResponse): Promise<void> {
  const dlqFiles = await globJsonFiles(join(DATA_DIR, 'failed'), 'crm-sync-');
  jsonResponse(res, 200, dlqFiles);
}

async function handleConfig(res: ServerResponse): Promise<void> {
  if (!existsSync(BUSINESS_DIR)) {
    jsonResponse(res, 200, { businesses: [] });
    return;
  }

  const dirs = await readdir(BUSINESS_DIR);
  const businesses = await Promise.all(
    dirs
      .filter(d => existsSync(join(BUSINESS_DIR, d, 'profile.yaml')))
      .map(async (dir) => {
        const businessDir = join(BUSINESS_DIR, dir);
        const yaml = await import('yaml');

        const readYaml = async (filename: string): Promise<unknown> => {
          const p = join(businessDir, filename);
          if (!existsSync(p)) return null;
          try {
            const raw = await readFile(p, 'utf-8');
            return yaml.parse(raw);
          } catch { return null; }
        };

        const profile = await readYaml('profile.yaml');
        const channels = await readYaml('channels.yaml');
        const conversion = await readYaml('conversion.yaml');
        const crm = await readYaml('crm.yaml');

        return { name: dir, profile, channels, conversion, crm };
      })
  );

  jsonResponse(res, 200, { businesses });
}

async function handleTasks(res: ServerResponse): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const tasksPath = join(DATA_DIR, 'tmp', `tasks-${today}.json`);
  const tasks = await readJsonFile<unknown[]>(tasksPath, []);
  jsonResponse(res, 200, { date: today, tasks });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const API_ROUTES: Record<string, (res: ServerResponse, url: URL) => Promise<void>> = {
  '/api/state':             (res, _url) => handleGetState(res),
  '/api/run-history':       (res, url)  => handleRunHistory(res, url),
  '/api/run-history/stats': (res, url)  => handleRunHistoryStats(res, url),
  '/api/health':            (res, _url) => handleHealth(res),
  '/api/feedback/insights': (res, _url) => handleFeedbackInsights(res),
  '/api/feedback/events':   (res, _url) => handleFeedbackEvents(res),
  '/api/feedback/learned':  (res, _url) => handleFeedbackLearned(res),
  '/api/leads':             (res, _url) => handleLeads(res),
  '/api/dlq':               (res, _url) => handleDlq(res),
  '/api/config':            (res, _url) => handleConfig(res),
  '/api/tasks':             (res, _url) => handleTasks(res),
};

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    errorResponse(res, 405, 'Method not allowed');
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname.replace(/\/$/, '') || '/';

  // API routes
  const handler = API_ROUTES[pathname];
  if (handler) {
    try {
      await handler(res, url);
    } catch (e) {
      errorResponse(res, 500, `Internal error: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }

  // Static files (production mode)
  if (existsSync(WEB_DIST)) {
    const filePath = pathname === '/'
      ? join(WEB_DIST, 'index.html')
      : join(WEB_DIST, pathname);

    if (await serveStaticFile(res, filePath)) return;

    // SPA fallback
    if (await serveStaticFile(res, join(WEB_DIST, 'index.html'))) return;
  }

  errorResponse(res, 404, 'Not found');
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error('[web-server] unhandled error:', err);
    if (!res.headersSent) errorResponse(res, 500, 'Internal server error');
  });
});

server.listen(PORT, () => {
  console.log(`🚀 探星 Web 仪表盘: http://localhost:${PORT}`);
  console.log(`   API 端点: ${Object.keys(API_ROUTES).join(', ')}`);
});
