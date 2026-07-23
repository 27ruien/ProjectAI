# ProjectAI 日报与企业微信同步手工 UAT

本流程只适用于 Local 或经明确授权的 Staging。不得在 Production 执行。全程只使用
`[ProjectAI-E2E]` 前缀的虚构项目、随记和任务，不记录 Cookie、Token、二维码、完整
Smart Sheet URL、客户内容或页面源码。

## 十分钟准备

1. 启动隔离数据库和本地应用：

   ```bash
   npm run uat:database
   npm run uat:reseed
   npm run uat:start
   ```

2. 打开 `http://127.0.0.1:3300/tool/projectai-uat/login`。临时账号和密码只保存在
   `.local/uat-credentials.json`；该文件权限必须为 `0600`，不得复制到 Issue、PR、
   聊天证据或截图。
3. 构建扩展：

   ```bash
   npm run uat:wecom:build
   ```

   从 `dist/wecom-timesheet-extension-uat` 加载未打包扩展。若本地没有经过审查的
   `.local/wecom-selector.local.json`，该构建只提供连接诊断，实际同步保持禁用。
4. 用隔离浏览器打开已批准的企业微信页面，由用户手动登录。不要导出或持久化浏览器
   认证状态。

## ProjectAI 日报验收

1. 使用 UAT Project Manager 登录，确认只能看到 `ProjectAI WeCom UAT`。
2. 创建、编辑并删除一条 `[ProjectAI-E2E]` 随记；刷新后确认持久化。
3. 对三条虚构随记执行 AI 整理，确认完成/进行中/待处理状态、工时和进度均有来源；
   低置信字段必须显示人工复核提示。
4. 执行拆分、合并、修改和人工确认；复制并下载服务端权威 JSON。
5. 修改已确认草稿，确认状态退回待确认；重新确认后才允许开始同步。
6. 使用 UAT Restricted User 登录，确认不能读取、修改、导出或同步另一用户/项目日报。
7. 运行 `npm run test:uat:flags`，确认日报 Flag 关闭时 UI/API 均拒绝，WeCom Flag
   关闭时同步 UI/API 均拒绝。

## 企业微信字段核对

只接受可唯一定位的 role、label、accessible name 或稳定 `data-*` 属性。不得使用坐标、
OCR、随机 class、`nth-child`、模糊文本或“选择第一个”代替可靠 Selector。

逐项核对以下八个目标字段：

1. 任务详情：`[ProjectAI-E2E] UAT sync verification`
2. 项目：`ProjectAI WeCom UAT`
3. 提交人：只回读页面当前登录用户，不由扩展写入
4. 正常工时：`1`
5. 加班工时：`0`
6. 状态：`进行中`
7. 紧急重要度：`重要`
8. 进度：`25`

ProjectAI 的内部分类不得写入企业微信。

## Dry Run 和单条保存

1. 第一次必须开启 Dry Run，只填一条虚构任务。
2. 回读并逐项确认八字段；任务表单内单条保存点击数和最外层最终提交点击数都必须为
   `0`。
3. 只有用户明确确认 Dry Run 后，才允许关闭 Dry Run，并只点击任务表单内的单条保存。
4. 同时验证本次保存成功反馈和任务列表唯一回读；任一证据缺失时状态不得为 `saved`。
5. 刷新页面，确认任务仍存在；对同一 request 重试，确认没有第二条任务。
6. 最外层最终提交始终不得点击，页面停留在最终提交前。
7. 结束时只删除本次 `[ProjectAI-E2E]` 测试任务和 UAT 数据，不修改原有记录。

## 当前真实页面结论

2026-07-23 的只读检查确认批准 Origin、用户登录和页面可访问，但主任务看板由 Canvas
呈现，没有暴露可审核、唯一且稳定的表格/单元格 DOM。按上述边界，真实 Selector、
Dry Run、单条保存、刷新幂等和删除清理均为 **BLOCKED**，不得用坐标或猜测操作绕过。
这不影响 Mock 和 Local UAT 的自动化结果，但真实连接器在该阻塞关闭前不能宣称可用。
