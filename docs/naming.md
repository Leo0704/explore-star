# 命名规范

本项目在不同语境下使用多种名称，本文档统一约定。

## 框架名（项目本身）

| 写法 | 适用场景 |
|---|---|
| **探星** | 中文文档、用户界面、UI 文案、issue / commit message |
| **explore-star** | 英文 / 技术场景：npm 包名、CLI 命令、源码注释、GitHub URL |

> 两者是**等价名**，指同一个项目。在中文场景统一用「探星」，在英文 / 技术场景统一用 `explore-star`（小写连字符）。

## ❌ 不推荐写法

- **Explore-Star**（驼峰大写）—— 文档中避免，统一用小写 `explore-star`
- **探星框架** —— 冗余，「探星」已是框架名
- **ExploreStar**（无连字符）—— 避免歧义

## 示例业务（不是框架名）

- **燃点 FDE** —— `business.example/燃点-FDE/` 中的**示例业务**，仅作 init 模板
- 「燃点」、「燃点 FDE」都是这个示例业务在不同地方的别称
- 真实业务应使用自己的名称（中文 / 英文均可）

## 文档 / 代码引用规则

- 文档标题：用「探星」
- CLI 示例：用 `explore-star`
- package.json `name`：`explore-star`（npm 包名）
- 环境变量：`EXPLORE_STAR_*`（大写下划线）
- 数据库 / 配置文件目录：`data/explore-star/`
- npm 脚本：`npm run explore-star:xxx`（如有）

## 看到混用时怎么办

- 中文 doc 出现 `explore-star`  → OK
- 英文 doc 出现「探星」  → OK
- 任何地方出现 `Explore-Star`（大写连字符） → 改为 `explore-star`
- 任何地方把「燃点 FDE」当成框架名 → 改为「探星」

## 变更记录

- V0.1：初版约定，定义框架双名 + 示例业务边界
