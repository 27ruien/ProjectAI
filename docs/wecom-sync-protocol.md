# ProjectAI ↔ WeCom 扩展同步协议

协议版本固定为 `1`。所有 UUID、日期、时间、字段长度、枚举、任务数量和未知字段均严格校验。

## Payload

```json
{
  "version": 1,
  "request_id": "11111111-1111-4111-8111-111111111111",
  "sync_batch_id": "22222222-2222-4222-8222-222222222222",
  "date": "2026-07-22",
  "source": "project-ai",
  "confirmed_at": "2026-07-22T10:00:00+08:00",
  "draft_version": 3,
  "dry_run": true,
  "tasks": [
    {
      "id": "task-id",
      "description": "完成虚构页面跳转逻辑确认",
      "project": { "id": "project-001", "name": "虚构项目" },
      "submitter": { "id": null, "name": null, "source": "authenticated-user" },
      "regularHours": 1,
      "overtimeHours": 0,
      "category": { "id": "communication", "name": "项目沟通" },
      "status": { "id": null, "name": "已完成" },
      "urgency": null,
      "progress": 100
    }
  ]
}
```

`confirmed_at` 与 `draft_version` 使扩展只能接收人工确认后的版本。后端创建批次时重新核对所有必填字段和项目权限。`submitter` 只表示“使用当前企业微信登录用户”，Adapter 不选择或写入其他人；它只回读页面自动填充的非空提交人。`category` 保留为 ProjectAI 内部审核字段，Adapter 不把它写入企业微信任何列，尤其不会写入“紧急重要度”。

手工 Popup JSON 不是服务端确认凭据，因此 Review 与真实 Origin 构建会强制它保持 Dry Run；实际逐条保存只能由已认证 ProjectAI 页面取得服务端批次后发起。只有隔离 Mock 构建允许用手工 JSON 演练非 Dry Run 路径。

协议版本 1 继续接受旧任务形状中的 `hours`，并只转换为 `regularHours`；缺失的加班工时保持 `null`，不会自动写成 0。新草稿必须由用户分别确认正常工时和加班工时，二者均为非负 0.25 小时精度且合计不超过 24 小时。`urgency` 与 `progress` 没有可靠来源时保持 `null`。

## 页面消息

页面只向 `window.location.origin` 发送消息。ProjectAI content script 只在顶层 frame 接受 `event.source === window`、精确受信 Origin、`source=project-ai`、版本匹配且字段集合精确的消息：

- `PROJECT_AI_EXTENSION_PING`
- `PROJECT_AI_OPEN_WECOM_BOARD`
- `PROJECT_AI_SYNC_TIMESHEET`
- `PROJECT_AI_SYNC_CONTROL`（pause/resume/cancel）

扩展回传：READY、ACCEPTED、PROGRESS、COMPLETED、FAILED、CANCELLED。状态响应包含 `request_id`、`sync_batch_id`、ISO timestamp、status 和逐项摘要。后端 API 再校验 Session、组织、批次创建者、逐项 task 归属、不可回退的 saved 状态以及终态与逐项状态的一致性。

## 幂等和恢复

幂等键为 `sync_batch_id:task.id`。扩展对整个 Payload 做排序后的精确 canonical JSON 比较，不用短哈希作信任决策。同 batch 的相同 Payload 返回已有状态；内容变化返回 replay conflict。

- saved：永远跳过；保存成功必须同时取得本次页面反馈，并在任务列表中按字段重新回读；
- failed：仅用户点击继续后重试；
- unknown：暂停且拒绝继续；用户先在企业微信人工核对，再在 Popup 二次确认“已保存”或“未保存”。前者永久跳过，后者转 failed 后仍需主动继续；
- Service Worker 启动时遗留 running：转 unknown，不自动执行；登录失效项只在用户明确点击继续后重新入队；
- cancel：已保存项不回滚；正在保存的单条先等待明确结果，再取消剩余项；若结果 unknown，批次保持 paused 并要求人工核对。

ProjectAI 服务端要求每次进度回写包含批次完整 task 集合。终态批次不可重新打开，attempt 不能回退，`saved`、`unknown` 和 `cancelled` 项不能通过迟到消息改回可执行状态。页面按扩展事件顺序串行写回，避免并发 HTTP 响应重排。

状态和脱敏日志只保存在 `chrome.storage.local`。扩展不上传 Cookie、Token、二维码、HTML、浏览历史或完整 DOM。
