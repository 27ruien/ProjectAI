# WeCom Dry Run

Dry Run 用于验证 Origin、登录、iframe、Selector、字段写入、精确匹配与已选值，不创建企业微信任务。

## Mock 验证

```bash
npm run test:extension-e2e
```

测试构建只绑定本机 Mock Origin，覆盖正常填写、未登录、遮罩、重复项目、保存失败、保存未知和结构变化。Mock 最终提交计数在所有场景必须保持 `0`。

## 人工 Dry Run

1. 在 ProjectAI 确认日报，确保任务、项目、正常工时、加班工时、内部分类、状态及可选进度均已人工审核；内部分类不会写入 WeCom。
2. 安装已绑定精确企业微信 Origin 的扩展并在 Options 保存经审核的 Selector Config。
3. 在 ProjectAI 或 Popup 保持 “Dry Run” 选中。
4. 用户手动登录企业微信；扩展不代填账号、不扫描二维码。
5. 启动同步。扩展可以打开看板、打开单条表单、填写字段并验证。
6. 检查每项返回 `validated`/后端逐项 `saved`（表示 dry-run validated），同时企业微信任务列表没有新增任务。
7. 确认单条保存和最终提交均未被点击。

只有全部字段唯一且二次验证成功、用户明确确认后，才可另建非 Dry Run 批次。第一次实际验证只允许一条虚构测试任务，只点击表单内单条保存并停在最外层最终提交之前；验收期间不得提交整个日报。

## 失败处理

- `LOGIN_REQUIRED`：手动登录后点击继续。
- `OPTION_NOT_FOUND` / `OPTION_AMBIGUOUS`：停止，核对真实目录或 Selector，不选近似项。
- `PAGE_OVERLAY_BLOCKING`：人工关闭弹窗后继续。
- `ELEMENT_TIMEOUT`：视为 DOM 变更；更新并复审 Selector。
- `SAVE_RESULT_UNKNOWN`：实际模式立即暂停；先人工检查是否已创建，禁止自动重试。
- `RECORD_*_MISMATCH` / `RECORD_READBACK_UNKNOWN`：页面反馈与任务列表事实不一致，禁止宣布成功或自动重试。
- `AUTO_SAVE_UNSUPPORTED`：页面会自动持久化；Adapter 在任何字段写入前停止，必须另做安全审查。
