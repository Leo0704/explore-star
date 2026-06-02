/**
 * HTTP client for communicating with the opencli daemon.
 *
 * Provides a typed send() function that posts a Command and returns a Result.
 */
import { DEFAULT_DAEMON_PORT } from '../constants.js';
import { sleep } from '../utils.js';
import { classifyBrowserError } from './errors.js';
import { resolveProfileContextId } from './profile.js';
const DAEMON_PORT = parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const OPENCLI_HEADERS = { 'X-OpenCLI': '1' };
let _idCounter = 0;
function generateId() {
    return `cmd_${process.pid}_${Date.now()}_${++_idCounter}`;
}
export class BrowserCommandError extends Error {
    code;
    hint;
    constructor(message, code, hint) {
        super(message);
        this.code = code;
        this.hint = hint;
        this.name = 'BrowserCommandError';
    }
}
async function requestDaemon(pathname, init) {
    const { timeout = 2000, headers, ...rest } = init ?? {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(`${DAEMON_URL}${pathname}`, {
            ...rest,
            headers: { ...OPENCLI_HEADERS, ...headers },
            signal: controller.signal,
        });
    }
    finally {
        clearTimeout(timer);
    }
}
export async function fetchDaemonStatus(opts) {
    try {
        const params = opts?.contextId ? `?contextId=${encodeURIComponent(opts.contextId)}` : '';
        const res = await requestDaemon(`/status${params}`, { timeout: opts?.timeout ?? 2000 });
        if (!res.ok)
            return null;
        return await res.json();
    }
    catch {
        return null;
    }
}
/**
 * Unified daemon health check — single entry point for all status queries.
 * Replaces isDaemonRunning(), isExtensionConnected(), and checkDaemonStatus().
 */
export async function getDaemonHealth(opts) {
    const status = await fetchDaemonStatus(opts);
    if (!status)
        return { state: 'stopped', status: null };
    if (status.profileRequired)
        return { state: 'profile-required', status };
    if (status.profileDisconnected)
        return { state: 'profile-disconnected', status };
    if (!status.extensionConnected)
        return { state: 'no-extension', status };
    return { state: 'ready', status };
}
export async function requestDaemonShutdown(opts) {
    try {
        const res = await requestDaemon('/shutdown', { method: 'POST', timeout: opts?.timeout ?? 5000 });
        return res.ok;
    }
    catch {
        return false;
    }
}
/**
 * Internal: send a command to the daemon with retry logic.
 * Returns the raw DaemonResult. All retry policy lives here — callers
 * (sendCommand, sendCommandFull) only shape the return value.
 *
 * Retries up to 4 times:
 * - Network errors (TypeError, AbortError): retry at 500ms
 * - Transient browser errors: retry at the delay suggested by classifyBrowserError()
 */
async function sendCommandRaw(action, params) {
    const maxRetries = 4;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const id = generateId();
        const rawWindowMode = process.env.OPENCLI_WINDOW;
        const envWindowMode = rawWindowMode === 'foreground' || rawWindowMode === 'background'
            ? rawWindowMode
            : undefined;
        const contextId = params.contextId ?? resolveProfileContextId();
        const windowMode = params.windowMode ?? envWindowMode;
        const command = { id, action, ...params, ...(contextId && { contextId }), ...(windowMode && { windowMode }) };
        try {
            const res = await requestDaemon('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(command),
                timeout: 30000,
            });
            const result = (await res.json());
            if (!result.ok) {
                if (result.errorCode === 'command_result_unknown') {
                    throw new BrowserCommandError(result.error ?? 'Browser command result is unknown', result.errorCode, result.errorHint);
                }
                const isDuplicateCommandId = res.status === 409
                    || (result.error ?? '').includes('Duplicate command id');
                if (isDuplicateCommandId && attempt < maxRetries) {
                    continue;
                }
                const advice = classifyBrowserError(new Error(result.error ?? ''));
                if (advice.retryable && attempt < maxRetries) {
                    await sleep(advice.delayMs);
                    continue;
                }
                throw new BrowserCommandError(result.error ?? 'Daemon command failed', result.errorCode, result.errorHint);
            }
            return result;
        }
        catch (err) {
            const isNetworkError = err instanceof TypeError
                || (err instanceof Error && err.name === 'AbortError');
            if (isNetworkError && attempt < maxRetries) {
                await sleep(500);
                continue;
            }
            throw err;
        }
    }
    throw new Error('sendCommand: max retries exhausted');
}
/**
 * Send a command to the daemon and return the result data.
 */
export async function sendCommand(action, params = {}) {
    const result = await sendCommandRaw(action, params);
    return result.data;
}
/**
 * Like sendCommand, but returns both data and page identity (targetId).
 * Use this for page-scoped commands where the caller needs the page identity.
 */
export async function sendCommandFull(action, params = {}) {
    const result = await sendCommandRaw(action, params);
    return { data: result.data, page: result.page };
}
export async function bindTab(session, opts = {}) {
    return sendCommand('bind', { session, surface: 'browser', ...opts });
}
