/**
 * Chrome 可执行文件路径解析（Y5）
 *
 * 三段式优先级：
 *   1. process.env.CHROME_EXECUTABLE_PATH  （显式环境变量，最优先）
 *   2. 调用方传入的 explicitPath         （来自 BrowserConfig.executablePath，保留向后兼容）
 *   3. puppeteer.executablePath('chrome')（puppeteer-core 跨平台默认值）
 *   4. 全部失败 → 抛出带平台提示的错误
 *
 * 用途：launchBrowser 启动前确定 Chrome 路径；CLI/CI 用户可透过 CHROME_EXECUTABLE_PATH 覆盖。
 *
 * 关于 puppeteer.executablePath('chrome')：puppeteer-core 不捆绑 Chrome，因此裸调
 * `executablePath()`（无参）会失败（依赖 lastLaunchedBrowser）。传入 'chrome' channel
 * 会走 @puppeteer/browsers 的系统 Chrome 解析，覆盖 macOS / Linux / Windows。
 */

import { existsSync } from 'node:fs';

const PLATFORM_HINT: Record<string, string> = {
  darwin:
    'macOS: 请安装 Google Chrome（https://www.google.com/chrome/），' +
    '或设置 CHROME_EXECUTABLE_PATH 指向 Chromium-based 浏览器',
  linux:
    'Linux: 请安装 google-chrome（apt install 或从 https://www.google.com/chrome/ 下载），' +
    '或设置 CHROME_EXECUTABLE_PATH',
  win32:
    'Windows: 请安装 Google Chrome（https://www.google.com/chrome/），' +
    '或设置 CHROME_EXECUTABLE_PATH 指向 chrome.exe',
};

/**
 * 当前平台的 Chrome 安装提示（找不到 Chrome 时使用）
 */
export function chromeInstallHint(): string {
  return (
    PLATFORM_HINT[process.platform] ??
    `当前平台 ${process.platform}：请安装 Google Chrome 或设置 CHROME_EXECUTABLE_PATH`
  );
}

/**
 * 断言 Chrome 可执行文件存在；不存在 throw 带平台提示的错误。
 *
 * 用于：CHROME_EXECUTABLE_PATH 用户提供的路径校验、最终兜底校验。
 */
export function assertChromePath(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Chrome 可执行文件未找到：${path}\n${chromeInstallHint()}`);
  }
}

/**
 * 解析 Chrome 可执行文件路径；找不到 throw。
 *
 * 优先级：env > explicitPath > puppeteer 跨平台默认。
 *
 * @param explicitPath  调用方显式提供的路径（如 BrowserConfig.executablePath）；
 *                      为空时跳过本阶段。
 * @returns             Chrome 绝对路径
 * @throws              Chrome 不存在时抛出带平台提示的错误
 */
export async function resolveChromePath(explicitPath?: string): Promise<string> {
  // 1. 显式环境变量（最优先）
  const envPath = process.env.CHROME_EXECUTABLE_PATH;
  if (envPath) {
    assertChromePath(envPath);
    return envPath;
  }

  // 2. 调用方传入的显式路径（来自 BrowserConfig.executablePath，保留向后兼容）
  if (explicitPath) {
    assertChromePath(explicitPath);
    return explicitPath;
  }

  // 3. puppeteer-core 跨平台默认值
  //    实际为 ChromeLauncher.executablePath('chrome')，内部走 @puppeteer/browsers
  //    解析系统 Chrome：macOS /Applications/..., Linux /usr/bin/..., Windows 注册表/Program Files
  let defaultPath: string;
  try {
    const puppeteer = await import('puppeteer-core');
    defaultPath = await puppeteer.executablePath('chrome');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Chrome 未找到（puppeteer.executablePath 失败：${msg}）\n${chromeInstallHint()}`,
    );
  }

  // 4. 兜底再 assert 一次（puppeteer 内部 validatePath=true 已检查，但防御性校验）
  assertChromePath(defaultPath);
  return defaultPath;
}
