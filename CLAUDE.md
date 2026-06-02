# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. CodeGraph（必须使用）

项目已配置 CodeGraph（`.codegraph/`），提供 `codegraph_search`/`codegraph_callers`/`codegraph_trace`/`codegraph_impact` 等 MCP 工具。

**以下场景必须先调 CodeGraph，禁止手动 grep/read 遍历：**

| 场景 | 工具 | 说明 |
|---|---|---|
| **找函数/类/接口在哪** | `codegraph_search` | 搜名字，秒出文件+行号+签名 |
| **查谁调用了 X** | `codegraph_callers` | 改函数前必须查，确认影响范围 |
| **查 X 调用了谁** | `codegraph_callees` | 理解函数内部依赖 |
| **追踪调用链 A→B** | `codegraph_trace` | 跨模块数据流追踪，如 `runDaily → executeTasks` |
| **改接口前查影响** | `codegraph_impact` | 改 `Lead`/`Task` 等核心类型前必须查 |
| **快速理解模块结构** | `codegraph_explore` | 按文件/符号批量读取上下文 |
| **重构前定位相关文件** | `codegraph_files` | 比 glob 更快，含符号统计 |

**不需要 CodeGraph 的场景：**
- 逐行审查业务逻辑是否闭环（需要人读代码）
- 修改单个文件内的局部代码
- 写测试、写配置

## 6. 回复规范

**每次回复必须以「老板，」开头**，用于验证 agent 是否遵循了本文件的规则。

格式要求：
- **语言**：统一使用中文，技术术语可保留英文（如函数名、API、CLI 命令）
- **开头**：必须以「老板，」起手，后面跟正文
- **正文**：简洁直接，先结论后展开，避免废话
- **代码/命令**：用 markdown 代码块包裹
- **列表/表格**：结构化信息优先用表格或列表，不用大段文字

示例：
```
老板，改完了。3 个文件变更，测试全绿。

| 文件 | 改动 |
|---|---|
| `xxx.ts` | 新增函数 |
| `yyy.ts` | 修复 bug |
```
