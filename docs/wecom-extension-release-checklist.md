# WeCom Connector 发布材料与检查清单

## Chrome Web Store 中文简介（草案）

ProjectAI 企业微信工时同步连接器帮助项目经理把已人工确认的日报任务逐条填写到指定企业微信任务看板。支持 Dry Run、精确项目/分类/状态匹配、iframe 表单、逐条结果、暂停/恢复、重启防重复和脱敏错误导出。扩展不会调用 AI，不读取登录凭据，也不会点击日报或看板的最终提交；最终检查和提交始终由用户完成。

## Chrome Web Store English description (draft)

ProjectAI WeCom Timesheet Connector transfers user-reviewed daily-timesheet tasks from ProjectAI into an approved WeCom task board one item at a time. It supports Dry Run, exact project/category/status matching, iframe forms, per-item progress, pause/recovery, restart-safe idempotency, and redacted error export. The extension does not run AI, read login credentials, or click the outer final-submit action. The user always performs the final review and submission.

## 发布前

- [ ] 法务审核 `PRIVACY_POLICY_DRAFT.md` 并补发布主体、联系与托管 URL。
- [ ] 安全审核 `SECURITY_THREAT_MODEL.md` 与权限说明。
- [ ] 获得真实 `WECOM_TASK_BOARD_URL`，确认精确 HTTPS Origin。
- [ ] 用户手动登录并演示完整单条创建流程；不采集凭据/二维码/完整 HTML。
- [ ] 完成真实 Selector Config 审查并确认没有最终提交键。
- [ ] 使用精确 URL 重建；manifest 无 `<all_urls>`、远程脚本或未知 Origin。
- [ ] 运行 typecheck、lint、42+ unit、package tests、9+ Mock E2E、ProjectAI E2E 与构建。
- [ ] 执行真实 Dry Run、一条虚构保存、失败/登录/重启/重放场景。
- [ ] 检查 ZIP 根目录 `manifest.json`，无 map、测试、日志、local config、Secret。
- [ ] 准备审核截图，只含虚构数据，不含二维码、Cookie、Token 或客户资料。

## 本地安装/更新

```bash
npm ci
WECOM_TASK_BOARD_URL=https://approved.example/path npm run extension:build
```

打开 `chrome://extensions` → 开启开发者模式 → “加载已解压的扩展程序” → 选择 `dist/wecom-timesheet-extension`。更新时重新构建后在扩展卡片点击“重新加载”，刷新 ProjectAI 与 WeCom 页面，并重新执行 Dry Run。不要直接分发未审核、未绑定真实 Origin 的评审 ZIP。
