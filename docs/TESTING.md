# Testing

## 测试分层

1. TypeScript：`npm run typecheck`。
2. ESLint：`npm run lint`。
3. SSR/路由：`npm test`。
4. 浏览器主流程：`npm run test:e2e`。
5. 完整 MVP 验证：`npm run qa:mvp`。
6. Production/Staging：HTTP、深层路由、MIME、容器健康、Nginx 日志回归。

## Playwright 环境

- 默认本地 basePath：`/tool/projectai`。
- Staging basePath：`/tool/projectai-staging`。
- 使用 `PLAYWRIGHT_BASE_URL` 指向已运行环境；未设置时 Playwright 启动本地 vinext server。
- 浏览器只安装 Chromium；Node.js 版本为 22。

## MVP E2E 清单

### 项目知识问答

进入项目 → 项目知识 → 预设问题 → 回答 → 来源文件/章节/页码/版本 → 来源详情。

### 需求提取与审核

选择 Mock 文件 → 启动 → 可恢复失败 → Retry → 完成 → 审核中心 → 编辑草稿/备注 → 修改后通过 → 状态反馈。

### Action 状态持久化

进入 Action Plan → 修改 ACT-001 → 刷新 → 验证恢复 → 清理测试 key，避免污染后续测试。

## 运行时错误契约

每条 E2E 监听：

- `console.error`。
- `pageerror` 与未处理 Promise rejection。
- `requestfailed`。
- HTTP 500 及以上响应。

失败附件：screenshot、video、trace、HTML report、console/network log。不得通过全局忽略错误让测试“变绿”；若允许第三方失败，必须按 URL 精确写明原因。

## 选择器原则

- 优先 role、accessible name、label、heading 和稳定业务 ID。
- 不依赖 Tailwind class、DOM 层级或随机时间戳。
- 组件新增交互时同步维护可访问名称和 E2E。

## 本地命令

```bash
npm ci
npx playwright install chromium
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run qa:mvp
```

测试输出目录 `test-results/`、`playwright-report/`、trace、video 和 screenshot 不得提交。

## CI

PR 与 main push 运行 Node 22、npm cache、Chromium 安装、类型检查、lint、SSR、E2E 和 build；新提交取消同分支旧任务。失败时上传 Playwright 报告和测试证据，不进行生产部署。
