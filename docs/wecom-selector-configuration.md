# 企业微信 Selector Config 配置

真实企业微信页面已经完成可见字段的只读核对，但受控 DOM 通道尚不可用。本仓库只提交 Mock Selector 示例，不猜测正式选择器。真实配置必须由用户手动登录并演示一次“创建单条任务”后，由开发者确认稳定 DOM、iframe 和控件语义；不得读取、记录或导出 Cookie、Token、二维码、完整 HTML。真实地址在证据中只能写为 `https://doc.weixin.qq.com/smartsheet/[REDACTED]`。

## 构建 Origin 边界

1. 获取精确的 `WECOM_TASK_BOARD_URL`，确认不含 URL username/password。授权页面必需的 query/fragment 只允许保留在被忽略的本地环境与扩展本机存储，禁止写入命令日志、Git、PR 或 Artifact。
2. 同时提供精确 HTTPS Origin、URL 和本地 Selector 文件构建：

   ```bash
   PROJECTAI_ALLOWED_ORIGIN=https://projectai.example \
   WECOM_ALLOWED_ORIGIN=https://approved-wecom.example \
   WECOM_TASK_BOARD_URL=https://approved-wecom.example/path \
   WECOM_SELECTOR_CONFIG_PATH=wecom-selector.local.json \
   npm run extension:build
   ```

3. 检查 `dist/wecom-timesheet-extension/manifest.json`：`optional_host_permissions` 只能包含该精确 Origin，不得出现 `<all_urls>` 或通配任意域。
4. 在 Options 保存精确完整看板 URL 并授予 Origin 权限。运行时只复用 Origin、pathname、query 与 fragment 全部一致的标签页，避免误操作同文档的其他视图；构建只嵌入允许 Origin，不把文档路径或访问参数写入 JS/manifest/build bindings。

未提供构建 Origin 时，Options 会明确拒绝真实 URL，扩展不会对未知网站执行 Adapter。

## 类型化字段

配置必须且只能包含以下键：

```text
boardReady, loggedOutIndicator, overlay, formIframe, createTaskButton,
taskForm, descriptionInput, projectControl, projectOptions,
projectSelectedValue, submitterValue, regularHoursInput, overtimeHoursInput,
statusControl, statusOptions, statusSelectedValue, urgencyControl,
urgencyOptions, urgencySelectedValue, progressInput, itemSaveButton,
saveSuccess, saveFailure, recordRows, recordDescription, recordProject,
recordSubmitter, recordRegularHours, recordOvertimeHours, recordStatus,
recordUrgency, recordProgress，以及 persistenceMode
```

`finalSubmit`、`submitAll`、`dailySubmit` 或相似键会被拒绝。正式配置保存在扩展本地存储，不提交 Git；`.gitignore` 已覆盖 `selector-config.local*`。

## 选择原则

- 优先可访问名称、role、label、稳定 `data-*` 属性或业务语义；避免随机 class、位置索引和模糊包含。
- `formIframe` 必须只定位任务表单 iframe；字段查询在该 iframe document 内执行。
- 项目和状态按可见文本精确且唯一匹配，写入后读取已选值二次验证；紧急重要度只有在受信候选项完成配置且 Payload 非空时才写入。ProjectAI 分类永不写入真实页面。
- 提交人只回读当前页面自动填充值，Adapter 不点击或修改提交人；正常工时和加班工时分别写入，旧协议没有加班值时保持不写。
- `itemSaveButton` 只能是 `taskForm` 内的单条表单保存；Adapter 会再次验证 DOM 归属，并拒绝文案或 `aria-label` 含“最终提交/提交日报/全部提交”等语义的控件。`saveSuccess`/`saveFailure` 必须是本次保存后新增的明确反馈。
- `persistenceMode=auto-save` 当前在任何字段 mutation 前硬停止；只有完成专门审查的 `explicit-save` 页面可执行。实际保存后还必须唯一定位任务列表行并回读所有已写字段，否则不得宣布成功。
- 任何控件找不到、出现多个同名项、值不一致、遮罩阻塞或结果无法确认时暂停，不尝试相邻或近似按钮。

## 配置验证顺序

先使用 `selector-config.example.json` 和 Mock E2E，随后在真实页面：登录 → 观察 iframe → 逐字段验证 → Dry Run 一条 → 用户确认字段 → 实际保存一条虚构测试任务。未通过 Dry Run 不得执行实际保存。
