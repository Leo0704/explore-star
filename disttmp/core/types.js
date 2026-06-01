/**
 * 探星（Explore-Star）核心类型定义
 *
 * 这是所有跨模块数据结构的**单一真相源**。所有 Adapter 实现、模块
 * 输入输出都必须用这里的类型（不允许在模块内重新定义 Lead / Profile 等）。
 *
 * 对应文档：
 *   - §3.3 Lead 字段
 *   - §3.5 CRM 标准字段映射
 *   - §3.6.1 Task / TaskResult
 *   - §2.4 business/*.yaml schema
 *   - §13.4 Adapter 接口
 *
 * 设计原则：
 *   1. 业务无关：所有字段对任意业务通用
 *   2. 严格 null/undefined 区分
 *   3. 时间字段统一 ISO 8601 字符串（不混用 Date 对象，方便 JSON 序列化）
 *   4. 任何「业务方自定义」字段用 Record<string, unknown> 兜底
 */
export {};
//# sourceMappingURL=types.js.map