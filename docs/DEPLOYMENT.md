# Deployment

## 环境矩阵

| 环境 | URL | 目录 | 容器 | 宿主机端口 | basePath |
| --- | --- | --- | --- | --- | --- |
| Production | https://gridworks.cn/tool/projectai/ | `/srv/projectai` | `project-ai-os` | `127.0.0.1:3100` | `/tool/projectai` |
| Staging | https://gridworks.cn/tool/projectai-staging/ | `/srv/projectai-staging` | `project-ai-os-staging` | `127.0.0.1:3101` | `/tool/projectai-staging` |

本轮只部署 Staging。不得停止、重建或替换 Production 容器，不得修改 `/srv/projectai`。

## Staging 构建元数据

构建时设置：

```env
NEXT_PUBLIC_BASE_PATH=/tool/projectai-staging
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_APP_VERSION=0.2.0-staging
NEXT_PUBLIC_COMMIT_SHA=<feature branch sha>
NEXT_PUBLIC_BUILD_TIME=<ISO-8601>
AI_PROVIDER=mock
```

环境条必须显示上述信息和 Mock 安全提示；页面 robots 与 Nginx header 均设置 noindex。

## Staging 部署

使用 `scripts/deploy-staging.sh`。脚本校验功能分支、干净工作区、Commit、独立目录/Compose project，备份上一份 Staging 源码，构建并启动 3101，然后验证健康、深层路由、CSS/JS/字体 MIME 和 Production 回归。首次 Nginx 尚未接入时可用 `PUBLIC_VALIDATION=0` 只完成上游验收；Nginx 安全接入后必须按默认 `PUBLIC_VALIDATION=1` 再执行完整公网验证。

服务器不得保存个人 GitHub Token。首次或 PR 迭代可从本地已审查 Commit 生成 release archive，再提升到 `/srv/projectai-staging`。

## Nginx

- 实际站点文件必须先通过服务器检查确认。
- 每次修改前创建时间戳备份。
- 只向现有 HTTPS server block 增加 staging exact/assets/general locations。
- 通用 proxy 保留完整 basePath；静态 assets location 只剥离已知 `/tool/projectai-staging/assets/` 前缀。
- 当前 vinext `next/font` 仍生成同源 `/assets/_vinext_fonts/` URL，本次复用已有 Production 窄映射；升级字体或 vinext 后必须先验证 hash，不能增加宽泛 `/assets/` 代理。
- `nginx -t` 失败时恢复备份并禁止 reload。
- 不修改 DNS、证书、Production location、gridproject 或 timeline。

## 健康与验收

```text
http://127.0.0.1:3101/tool/projectai-staging/dashboard
```

检查首页和 dashboard/projects/reviews/settings 深层路由、CSS/JS/font/favicon/OG、noindex、STAGING 元数据、容器 healthy、Nginx 无新增错误。同时验证 Production 首页和 dashboard 仍为 200。

## 回滚

1. 将当前 `/srv/projectai-staging` 移到带时间戳的 failed 目录。
2. 恢复最近 `/srv/projectai-staging.backup.<timestamp>`。
3. 使用 `docker compose -p projectai-staging -f docker-compose.staging.yml up -d --build`。
4. 若需撤销 Nginx，恢复本次 staging 配置备份，执行 `nginx -t`，成功后 reload。
5. 重新验证 Staging 和 Production。

若 Staging 是首次部署且无上一应用版本，回滚方式是停止并移除 `project-ai-os-staging`，恢复 Nginx 备份；Production 不参与回滚。

## 日志

- Staging：`docker compose -p projectai-staging -f /srv/projectai-staging/docker-compose.staging.yml logs --tail=200`。
- Nginx：只检查本次请求时间窗，避免把历史错误误判为当前回归。
- 日志不得输出密钥、文件内容或客户资料。
