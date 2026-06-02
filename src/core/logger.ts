/**
 * 统一日志器（pino）
 *
 * 用法：
 *   import { logger } from '../core/logger.js';
 *   const log = logger.child({ module: 'foo' });
 *   log.info({ count: 3 }, '处理了 N 条');
 *   log.error({ err }, '失败');
 *
 * 配置：
 *   - LOG_LEVEL  控制 level（默认 info）
 *   - NODE_ENV=production → JSON 输出（机器可读）
 *   - 其他         → pino-pretty（开发友好）
 */

import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }),
});
