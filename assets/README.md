# Assets —— 客户加微后推送的获客物料

> 此目录由 `conversion.yaml:32-35` 的 `post_add_asset` 字段引用。
> 当前状态：**待业务方填入真实物料**（不要让自动化流程去 404）。

## 必填文件

### `ai-readiness-checklist.pdf`
- **用途**：客户在抖音评论里"加微"后，系统自动推给他的第一份资料
- **当前 yaml 路径**：`./assets/ai-readiness-checklist.pdf`（相对业务目录根）
- **典型内容**：20-30 页的 PDF，覆盖客户行业常见痛点 + 自检清单 + 案例
- **推荐工具**：Typora / Notion 导出 / LaTeX / Canva

## 命名建议

如果你要加多份物料（比如按 persona 分），建议：
```
assets/
├── ai-readiness-checklist-self-media.pdf   # 自媒体版
├── ai-readiness-checklist-ecommerce.pdf    # 电商版
└── ai-readiness-checklist-education.pdf    # 教育版
```

然后改 `conversion.yaml`：
```yaml
post_add_asset:
  type: pdf
  name: "AI 落地自查清单（自媒体版）"
  path: "./assets/ai-readiness-checklist-self-media.pdf"
```

或者更优雅：把 `post_add_asset` 改成函数式（按 persona 选不同 PDF），但那是 V2 的事。

## 当前未上传的影响

跑 `npx explore-star run --business=./business.example/燃点-FDE` 时：
- LLM 分析 → 生成 lead → 状态推进到「已加微」
- 系统会尝试发 PDF，**因为文件不存在会报错**
- 错误会进 `data/failed/`，`retry-dlq` 也救不回来（文件确实没有）
- 不会让整个 pipeline 挂掉，但加微动作是哑的

## 验证

文件就位后跑：

```bash
ls -lh business.example/燃点-FDE/assets/*.pdf
npx explore-star run --business=./business.example/燃点-FDE --dry-run
```

`--dry-run` 不会真发微信，但会打印"将要推送的资料路径"，确认路径对了就行。
