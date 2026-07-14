## 本轮目标

<!-- 说明要验证的问题，不扩大业务范围。 -->

## 修改内容

-

## 影响页面

-

## 变更检查

- [ ] 是否修改数据结构：否 / 是（说明）
- [ ] PostgreSQL Migration 已提交，未对 Staging/Production 使用 schema push
- [ ] Seed 为 insert-only 幂等且凭据只来自环境变量
- [ ] 是否修改 AI 契约：否 / 是（说明）
- [ ] 是否修改部署：否 / 是（说明）
- [ ] 未提交 `.env`、密钥、客户文件或测试大文件
- [ ] 未重新部署 Production
- [ ] Mock/真实能力边界与 `projectId` 服务端过滤已说明

## 测试结果

- Typecheck：
- Lint：
- SSR/单元测试：
- Production build：
- PostgreSQL/授权集成测试（当前 27 条）：
- Artifact sanitizer + Manifest 合同测试（当前 32 条）：

## Playwright 结果

- 项目知识问答：
- 需求提取与审核：
- Action 状态持久化：
- 身份、Session、角色与跨项目隔离：
- Console/page/network error monitor：

## Staging

- 地址：https://gridworks.cn/tool/projectai-staging/
- 实际运行 Commit（公网 `/api/health` 的 `x-projectai-commit-sha`）：
- Manifest `stagingSha`（不可观测时必须为 `null` 并说明原因）：
- PostgreSQL / 应用 Healthy：
- Migration / Seed / 备份验证：
- Cookie Prefix / Path / Secure / HttpOnly：
- Manager / Member / Viewer / Admin 与 404 防枚举：
- 最后一名 Manager PATCH/DELETE 409、拒绝审计与零 Manager 项目检查：
- noindex：
- Production 回归：

## 截图或证据

- GitHub Actions run：
- Payload A `product-review-evidence-*` artifact（name / ID / SHA-256 digest）：
- Provenance B `product-review-manifest-*` artifact：
- `sanitization-report.json`：
- Payload A 的 `review-artifacts/evidence-index.json` 与成功 CI 的 6 张必需产品审查截图（失败 CI 需列出缺失项）：
- Provenance B 权威 `manifest.json`：

### Provenance 核对

- [ ] `headSha` 等于 PR 分支实际 Head，不是 GitHub 临时 merge Commit
- [ ] `testedMergeSha` 等于该 Run 实际 checkout 并测试的 PR 临时 merge Commit
- [ ] `stagingSha` 等于健康响应头实际观测的运行 Commit，或明确为 `null`；未用 Head/Merge 回填
- [ ] `branch` 等于 PR head ref
- [ ] `workflowRunId` 等于上述 GitHub Actions Run
- [ ] `artifactId` 等于 Payload A 的真实 GitHub 数字 ID，不是 Provenance B 自身 ID
- [ ] `version` 与 `buildTime` 等于注入受测 build 的值，`buildTime` 不是 PR 更新时间或 Commit 时间
- [ ] Payload A 不含权威 `manifest.json`、`artifactId` 或 legacy 单一 `commit`

<!-- 只能使用已通过 sanitizer 最终复核的截图、report 或 trace 链接，不得上传原始 Secret/Session 数据。 -->

## 已知问题

-

## MVP_ACCEPTANCE 更新

- [ ] 已更新 `docs/MVP_ACCEPTANCE.md`
- [ ] 已更新 `docs/MVP_STATUS.md`
- 尚未完成 P0：
- 尚未完成 P1：

## 回滚方式

<!-- 说明代码与 Staging/Nginx 的回滚步骤；不得影响 Production。 -->
