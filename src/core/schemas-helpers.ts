/**
 * Zod helpers — 跨 schema 复用的基础原语
 */

import { z } from 'zod';

/** 非空字符串（去除首尾空白后 length > 0） */
export const NonEmptyString = z
  .string()
  .trim()
  .min(1, { message: '字符串不能为空' });
