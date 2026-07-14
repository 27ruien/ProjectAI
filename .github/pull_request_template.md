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
- PostgreSQL/授权集成测试（当前 20 条）：
- Artifact sanitizer 测试（当前 10 条）：

## Playwright 结果

- 项目知识问答：
- 需求提取与审核：
- Action 状态持久化：
- 身份、Session、角色与跨项目隔离：
- Console/page/network error monitor：

## Staging

- 地址：https://gridworks.cn/tool/projectai-staging/
- Commit：
- PostgreSQL / 应用 Healthy：
- Migration / Seed / 备份验证：
- Cookie Prefix / Path / Secure / HttpOnly：
- Manager / Member / Viewer / Admin 与 404 防枚举：
- noindex：
- Production 回归：

## 截图或证据

- GitHub Actions run：
- `product-review-evidence-*` artifact：
- `sanitization-report.json`：
- 成功 CI 的 6 张必需产品审查截图与 `manifest.json`（失败 CI 需列出缺失项）：

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
