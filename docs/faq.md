# FAQ

## 安装与运行

### Q: Node 版本要求？

Node.js >= 20。推荐使用 [nvm](https://github.com/nvm-sh/nvm) 管理 Node 版本。

### Q: 报错 "opencli: command not found"

需要安装 opencli：

```bash
npm install -g @jackwener/opencli
```

### Q: 报错 "抖音登录墙"

原因：抖音需要登录态才能抓评论。解决方案：
1. 在 Chrome 中打开 https://www.douyin.com 并登录
2. 确保 Chrome Profile 已登录
3. opencli 会自动使用已登录的 Chrome Profile

### Q: 如何找到 sec_uid？

1. 打开目标 KOL 的抖音主页（web 端）
2. URL 形如 `https://www.douyin.com/user/MS4wLjABAAAAxxxxxx`
3. `MS4wLjABAAAAxxxxxx` 就是 sec_uid

## 配置问题

### Q: 怎么修改关键词权重？

1. 运行 `npx explore-star insights` 生成周报
2. 查看 `data/feedback/weekly-insights.json` 中的 `suggested_weight`
3. 手动修改 `channels.yaml` 中的 `keywords` 权重
4. 或者开启 `feedback_config.auto_apply.keyword_weight: true` 自动应用

### Q: 怎么添加新的人设？

编辑 `profile.yaml` 中的 `target_personas`：

```yaml
target_personas:
  - id: ecommerce
    name: "电商老板"
    typical_pain_points:
      - "选品全凭感觉"
      - "库存积压严重"
```

### Q: 怎么修改钩子风格？

编辑 `profile.yaml` 中的 `hook_config.style`，可选风格：
- `朋友推荐，不像销售`（默认）
- `数据驱动`
- `顾问`
- `案例分享`

### Q: 怎么禁用自动调优？

```bash
npx explore-star configure --business ./my-business --disable auto_keyword_weight
```

## 转化问题

### Q: 怎么知道客户有没有预约？

1. 配置 `booking_provider`（飞书日历 / webhook）
2. 运行 `npx explore-star watch-bookings` 持续监听
3. 预约事件会自动更新 CRM 中的 lead 状态

### Q: 沉默客户再激活怎么触发？

每月 1 日自动运行，或者手动触发：

```bash
npx explore-star reactivate --business ./my-business
```

### Q: 转化日报在哪里？

每天 22:00 自动推送，也可以手动生成：

```bash
npx explore-star conversion-report --business ./my-business
```

## 数据与隐私

### Q: 数据存在哪里？

所有数据存在本地：
- `data/leads.csv` - CRM 数据
- `data/feedback/events.jsonl` - 事件日志
- `data/feedback/weekly-insights.json` - 周报

### Q: 数据会上传吗？

不会。探星是纯本地 CLI，所有数据都在本地，不上传到任何服务器。

### Q: 怎么删除所有数据？

```bash
rm -rf data/
```

## 故障排除

### Q: 任务执行后没有反应？

1. 检查 `config/safety.json` 中的限速配置
2. 检查 `config/EMERGENCY_STOP` 是否存在
3. 运行 `npx explore-star doctor` 检查健康状态

### Q: LLM 分析失败？

1. 检查 API Key 是否正确设置
2. 检查网络连接
3. 查看日志 `logs/` 目录

### Q: CRM 同步失败？

1. 检查 CRM 配置（`crm.yaml`）
2. 检查 API Token 是否有效
3. 查看 `data/failed-sync.json` 中的失败记录