# ProjectAI WeCom Timesheet Connector Privacy Policy — Draft

Last updated: 2026-07-22. This draft requires legal and product review before publication.

## Purpose

The extension helps a signed-in user transfer ProjectAI daily-timesheet tasks that the user has reviewed into the configured WeCom task board. It fills and, outside Dry Run, saves one task at a time. It never submits the outer daily report or task board.

## Data processed

The extension processes only the selected date, task description, project, regular/overtime hours, the current-page submitter value, ProjectAI-internal category, status, optional urgency/progress, request/batch/task identifiers, dry-run flag, per-item result, attempt count, timestamps, and controlled error codes. Category is validated as part of the ProjectAI payload but is never written into a WeCom field. These values are provided by the ProjectAI page or pasted by the user into the manual test entry.

## Local storage and retention

Batch payloads, idempotency state, the user-configured exact board URL (including access parameters required by that board), reviewed Selector Config, attempt state and redacted error logs are stored in `chrome.storage.local` on the user's browser profile. The exact URL is never embedded in the extension bundle, manifest, build bindings, public artifact or exported logs. Local values are retained until the user clears extension data or uninstalls the extension. “Clear local records” requires confirmation and does not delete tasks already saved in WeCom.

## Data not collected

The extension does not extract or transmit passwords, cookies, browser session tokens, login QR codes, full page HTML, browsing history, unrelated page content, model credentials, complete DOM snapshots or final-submit actions. The only page access value it stores is the exact board URL explicitly configured by the user. It has no analytics, advertising, remote JavaScript or external telemetry endpoint.

## Network and permissions

The extension runs only on the two declared ProjectAI paths and the exact WeCom Origin supplied at build/review time and granted by the user. It does not request `<all_urls>`. WeCom authentication remains entirely between the user's browser and WeCom.

## Sharing

The extension does not sell data or send it to the extension publisher. Task data is written only into the user-configured WeCom page as an explicit synchronization action. Exported redacted logs remain under the user's control.

## Security and user controls

Payloads and messages are strictly validated; ProjectAI Origin, top-level frame and runtime message sender are checked; saved items are idempotent; uncertain writes pause and require explicit manual reconciliation; and there is no final-submit Selector. Users can choose Dry Run, pause, cancel, resolve an unknown result after checking WeCom, export redacted errors and clear local data.

## Contact and changes

Publisher contact, legal entity, jurisdiction, support URL and deletion-request channel must be added before store submission. Material policy changes require a new review and updated publication date.

---

# 中文隐私说明草案

本扩展只处理用户已审核并主动同步的日期、任务描述、项目、正常/加班工时、页面当前提交人、ProjectAI 内部分类、状态、可空紧急度/进度、批次/任务标识与脱敏结果；内部分类不会写入企业微信字段。同步状态、幂等记录、用户明确配置的完整看板 URL（包括页面必需的访问参数）、Selector Config 和脱敏日志保存在用户浏览器的 `chrome.storage.local`；完整 URL 不进入扩展 Bundle、Manifest、Build Bindings、公共 Artifact 或导出日志。扩展不提取或上传账号密码、Cookie、浏览器 Session Token、登录二维码、完整网页 HTML、浏览历史、无关页面内容、模型密钥或完整 DOM，也没有分析、广告、远程脚本或遥测服务。用户可使用 Dry Run、暂停、取消、导出脱敏日志和二次确认清除本地数据。扩展只逐条保存任务，永不点击日报或任务看板最终提交。发布前必须补充发布主体、联系渠道与法律审核信息。
