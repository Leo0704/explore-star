import { BrowserBridge, CDPBridge } from './browser/index.js';
import { TimeoutError } from './errors.js';
import { isElectronApp } from './electron-apps.js';
import { log } from './logger.js';
/**
 * Returns the appropriate browser factory based on site type.
 * Uses CDPBridge for registered Electron apps, otherwise BrowserBridge.
 */
export function getBrowserFactory(site) {
    if (site && isElectronApp(site))
        return CDPBridge;
    return BrowserBridge;
}
function parseEnvTimeout(envVar, fallback) {
    const raw = process.env[envVar];
    if (raw === undefined)
        return fallback;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        log.warn(`[runtime] Invalid ${envVar}="${raw}", using default ${fallback}s`);
        return fallback;
    }
    return parsed;
}
export const DEFAULT_BROWSER_CONNECT_TIMEOUT = parseEnvTimeout('OPENCLI_BROWSER_CONNECT_TIMEOUT', 30);
export const DEFAULT_BROWSER_COMMAND_TIMEOUT = parseEnvTimeout('OPENCLI_BROWSER_COMMAND_TIMEOUT', 60);
/**
 * Timeout with seconds unit. Used for high-level command timeouts.
 */
export async function runWithTimeout(promise, opts) {
    const label = opts.label ?? 'Operation';
    return withTimeoutMs(promise, opts.timeout * 1000, () => new TimeoutError(label, opts.timeout, opts.hint));
}
/**
 * Timeout with milliseconds unit. Used for low-level internal timeouts.
 * Accepts a factory function to create the rejection error, keeping this
 * utility decoupled from specific error types.
 */
export function withTimeoutMs(promise, timeoutMs, makeError = 'Operation timed out') {
    const reject_ = typeof makeError === 'string'
        ? () => new Error(makeError)
        : makeError;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(reject_()), timeoutMs);
        promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
}
export async function browserSession(BrowserFactory, fn, opts = {}) {
    const browser = new BrowserFactory();
    try {
        const page = await browser.connect({
            timeout: DEFAULT_BROWSER_CONNECT_TIMEOUT,
            session: opts.session,
            cdpEndpoint: opts.cdpEndpoint,
            contextId: opts.contextId,
            idleTimeout: opts.idleTimeout,
            windowMode: opts.windowMode,
            surface: opts.surface,
            siteSession: opts.siteSession,
        });
        return await fn(page);
    }
    finally {
        await browser.close().catch(() => { });
    }
}
