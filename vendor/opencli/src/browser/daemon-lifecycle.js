import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_DAEMON_PORT } from '../constants.js';
import { fetchDaemonStatus, getDaemonHealth, requestDaemonShutdown } from './daemon-client.js';
export function resolveDaemonLaunchSpec() {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const parentDir = path.resolve(__dirname, '..');
    const daemonTs = path.join(parentDir, 'daemon.ts');
    const daemonJs = path.join(parentDir, 'daemon.js');
    const isTs = fs.existsSync(daemonTs);
    const scriptPath = isTs ? daemonTs : daemonJs;
    return {
        binary: process.execPath,
        args: isTs ? ['--import', 'tsx/esm', scriptPath] : [scriptPath],
        scriptPath,
    };
}
export function spawnDaemonProcess() {
    const launch = resolveDaemonLaunchSpec();
    const proc = spawn(launch.binary, launch.args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
    });
    proc.unref();
    return proc;
}
export async function waitForDaemonStop(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(200);
        const h = await getDaemonHealth();
        if (h.state === 'stopped')
            return true;
    }
    return false;
}
export async function waitForDaemonStatus(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const status = await fetchDaemonStatus({ timeout: Math.min(1000, Math.max(100, deadline - Date.now())) });
        if (status)
            return status;
        await sleep(200);
    }
    return null;
}
export async function restartDaemon(opts = {}) {
    const previousStatus = await fetchDaemonStatus();
    let stopped = previousStatus === null;
    if (previousStatus) {
        const shutdownAccepted = await requestDaemonShutdown();
        stopped = shutdownAccepted && await waitForDaemonStop(opts.stopTimeoutMs ?? 3000);
        if (!stopped) {
            return { previousStatus, status: previousStatus, stopped: false, spawned: false };
        }
    }
    spawnDaemonProcess();
    const status = await waitForDaemonStatus(opts.startTimeoutMs ?? 5000);
    return { previousStatus, status, stopped, spawned: true };
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export { DEFAULT_DAEMON_PORT };
