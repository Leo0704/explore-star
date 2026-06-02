/**
 * LLMOptions 扩展 — 通过 TypeScript declaration merging 加 taskHint 字段
 *
 * 不修改 core/types.ts(用户有未提交工作在该文件),但允许 adapter 读 opts.taskHint
 * 选不同 model(cheap/quality/intent/hook 等)。
 *
 * taskHint 是可选的,旧调用方不传也能继续工作(向后兼容)。
 */

declare module '../../core/types.js' {
  interface LLMOptions {
    /** 任务类型提示,intent-analyzer 传 'intent',hook-generator 传 'hook' */
    taskHint?: string;
  }
}

export {};
