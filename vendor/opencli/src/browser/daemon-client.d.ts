/**
 * HTTP client for communicating with the opencli daemon.
 *
 * Provides a typed send() function that posts a Command and returns a Result.
 */
export interface DaemonCommand {
    id: string;
    action: 'exec' | 'navigate' | 'tabs' | 'cookies' | 'screenshot' | 'close-window' | 'set-file-input' | 'insert-text' | 'bind' | 'network-capture-start' | 'network-capture-read' | 'wait-download' | 'cdp' | 'frames';
    /** Target page identity (targetId). Cross-layer contract with the extension. */
    page?: string;
    code?: string;
    session?: string;
    surface?: 'browser' | 'adapter';
    /** Adapter site session lifecycle. Persistent site sessions do not idle-expire. */
    siteSession?: 'ephemeral' | 'persistent';
    url?: string;
    op?: string;
    index?: number;
    domain?: string;
    format?: 'png' | 'jpeg';
    quality?: number;
    fullPage?: boolean;
    /** Override viewport width in CSS pixels for screenshot (0 / undefined = use current) */
    width?: number;
    /** Override viewport height in CSS pixels for screenshot (0 / undefined = use current; ignored when fullPage) */
    height?: number;
    /** Local file paths for set-file-input action */
    files?: string[];
    /** CSS selector for file input element (set-file-input action) */
    selector?: string;
    /** Raw text payload for insert-text action */
    text?: string;
    /** URL substring filter pattern for network capture */
    pattern?: string;
    /** Download wait timeout in milliseconds */
    timeoutMs?: number;
    cdpMethod?: string;
    cdpParams?: Record<string, unknown>;
    /** Window foreground/background policy for owned Browser Bridge containers. */
    windowMode?: 'foreground' | 'background';
    /** Custom idle timeout in seconds for this session. Overrides the default. */
    idleTimeout?: number;
    /** Frame index for cross-frame operations (0-based, from 'frames' action) */
    frameIndex?: number;
    /** Browser profile/context to route the command to. */
    contextId?: string;
}
export interface DaemonResult {
    id: string;
    ok: boolean;
    data?: unknown;
    error?: string;
    errorCode?: string;
    errorHint?: string;
    /** Page identity (targetId) — present on page-scoped command responses */
    page?: string;
}
export declare class BrowserCommandError extends Error {
    readonly code?: string | undefined;
    readonly hint?: string | undefined;
    constructor(message: string, code?: string | undefined, hint?: string | undefined);
}
export interface DaemonStatus {
    ok: boolean;
    pid: number;
    uptime: number;
    daemonVersion?: string;
    extensionConnected: boolean;
    extensionVersion?: string;
    extensionCompatRange?: string;
    contextId?: string;
    profileRequired?: boolean;
    profileDisconnected?: boolean;
    profiles?: BrowserProfileStatus[];
    pending: number;
    commandResultUnknown?: number;
    memoryMB: number;
    port: number;
}
export interface BrowserProfileStatus {
    contextId: string;
    extensionConnected: boolean;
    extensionVersion?: string;
    extensionCompatRange?: string;
    pending: number;
    lastSeenAt?: number;
}
export declare function fetchDaemonStatus(opts?: {
    timeout?: number;
    contextId?: string;
}): Promise<DaemonStatus | null>;
export type DaemonHealth = {
    state: 'stopped';
    status: null;
} | {
    state: 'no-extension';
    status: DaemonStatus;
} | {
    state: 'profile-required';
    status: DaemonStatus;
} | {
    state: 'profile-disconnected';
    status: DaemonStatus;
} | {
    state: 'ready';
    status: DaemonStatus;
};
/**
 * Unified daemon health check — single entry point for all status queries.
 * Replaces isDaemonRunning(), isExtensionConnected(), and checkDaemonStatus().
 */
export declare function getDaemonHealth(opts?: {
    timeout?: number;
    contextId?: string;
}): Promise<DaemonHealth>;
export declare function requestDaemonShutdown(opts?: {
    timeout?: number;
}): Promise<boolean>;
/**
 * Send a command to the daemon and return the result data.
 */
export declare function sendCommand(action: DaemonCommand['action'], params?: Omit<DaemonCommand, 'id' | 'action'>): Promise<unknown>;
/**
 * Like sendCommand, but returns both data and page identity (targetId).
 * Use this for page-scoped commands where the caller needs the page identity.
 */
export declare function sendCommandFull(action: DaemonCommand['action'], params?: Omit<DaemonCommand, 'id' | 'action'>): Promise<{
    data: unknown;
    page?: string;
}>;
export declare function bindTab(session: string, opts?: {
    contextId?: string;
}): Promise<unknown>;
