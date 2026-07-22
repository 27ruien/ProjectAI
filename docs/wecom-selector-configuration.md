# 企业微信 Selector Config 配置

真实企业微信任务看板 URL 与 DOM 尚未提供。本仓库只提交 Mock Selector 示例，不猜测正式选择器。真实配置必须由用户手动登录并演示一次“创建单条任务”后，由开发者在 DevTools 中确认稳定 DOM、iframe 和控件语义；不得读取、记录或导出 Cookie、Token、二维码、完整 HTML。

## 构建 Origin 边界

1. 获取精确的 `WECOM_TASK_BOARD_URL`，确认不含凭据、query secret 或 fragment。
2. 使用 HTTPS 精确 URL 构建：

   ```bash
   WECOM_TASK_BOARD_URL=https://exact-wecom-origin.example/path npm run extension:build
   ```

3. 检查 `dist/wecom-timesheet-extension/manifest.json`：`optional_host_permissions` 只能包含该精确 Origin，不得出现 `<all_urls>` 或通配任意域。
4. 在 Options 保存相同 Origin 的看板 URL并授予权限。

未提供构建 Origin 时，Options 会明确拒绝真实 URL，扩展不会对未知网站执行 Adapter。

## 类型化字段

配置必须且只能包含以下键：

```text
boardReady, loggedOutIndicator, overlay, formIframe, createTaskButton,
taskForm, descriptionInput, projectControl, projectOptions,
projectSelectedValue, hoursInput, categoryControl, categoryOptions,
categorySelectedValue, statusControl, statusOptions, statusSelectedValue,
itemSaveButton, saveSuccess, saveFailure
```

`finalSubmit`、`submitAll`、`dailySubmit` 或相似键会被拒绝。正式配置保存在扩展本地存储，不提交 Git；`.gitignore` 已覆盖 `selector-config.local*`。

## 选择原则

- 优先可访问名称、role、label、稳定 `data-*` 属性或业务语义；避免随机 class、位置索引和模糊包含。
- `formIframe` 必须只定位任务表单 iframe；字段查询在该 iframe document 内执行。
- 项目、分类、状态按可见文本精确且唯一匹配，写入后读取已选值二次验证。
- `itemSaveButton` 只能是 `taskForm` 内的单条表单保存；Adapter 会再次验证 DOM 归属，并拒绝文案或 `aria-label` 含“最终提交/提交日报/全部提交”等语义的控件。`saveSuccess`/`saveFailure` 必须是本次保存后新增的明确反馈。
- 任何控件找不到、出现多个同名项、值不一致、遮罩阻塞或结果无法确认时暂停，不尝试相邻或近似按钮。

## 配置验证顺序

先使用 `selector-config.example.json` 和 Mock E2E，随后在真实页面：登录 → 观察 iframe → 逐字段验证 → Dry Run 一条 → 用户确认字段 → 实际保存一条虚构测试任务。未通过 Dry Run 不得执行实际保存。
