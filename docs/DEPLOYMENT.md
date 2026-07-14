# Deployment

## 环境矩阵

| 环境 | URL | 目录 | 应用容器 | 数据库 | 宿主机端口 | basePath |
| --- | --- | --- | --- | --- | --- | --- |
| Production | https://gridworks.cn/tool/projectai/ | `/srv/projectai` | `project-ai-os` | 既有环境，本轮不得修改 | `127.0.0.1:3100` | `/tool/projectai` |
| Staging | https://gridworks.cn/tool/projectai-staging/ | `/srv/projectai-staging` | `project-ai-os-staging` | `project-ai-os-staging-postgres` + `projectai-staging-postgres` | `127.0.0.1:3101`；数据库不发布端口 | `/tool/projectai-staging` |

本轮只部署 Staging。不得停止、重建或替换 Production 容器，不得修改 `/srv/projectai`。

## Staging 构建元数据

构建时设置：

```env
NEXT_PUBLIC_BASE_PATH=/tool/projectai-staging
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_APP_VERSION=0.3.0-staging
NEXT_PUBLIC_COMMIT_SHA=<feature branch sha>
NEXT_PUBLIC_BUILD_TIME=<ISO-8601>
AI_PROVIDER=mock
```

环境条必须显示上述信息和 Mock 安全提示；页面 robots 与 Nginx header 均设置 noindex。

认证运行配置还必须包含完整 Staging endpoint `BETTER_AUTH_URL=https://gridworks.cn/tool/projectai-staging/api/auth`、独立 `AUTH_COOKIE_PREFIX` 和受信同源列表。Cookie 必须为 HttpOnly、SameSite=Lax、Secure，Path 必须为 `/tool/projectai-staging`；不得与 Production Cookie 共享前缀或 Path。

## 受保护环境文件

服务器实际值只保存在 `/srv/projectai-staging/.env.auth-staging`：

- 参考 `.env.auth-staging.example` 创建，但不得提交或 rsync 实际文件。
- 必须是普通文件而非 symlink，mode 为 `600`。
- 包含 PostgreSQL、`DATABASE_URL`、Better Auth Secret/URL 和 5 个 Seed 身份的邮箱/密码。
- PostgreSQL 密码至少 16 字符，Better Auth Secret 至少 32 字符，Seed 密码 12—128 字符。
- `DATABASE_URL` 必须使用内部服务 `projectai-postgres:5432`；任何日志、命令回显和 artifact 都不得打印连接串或凭据。

Compose 使用内部网络 `projectai-staging-internal`。PostgreSQL 17 必须 Healthy，数据保存于明确命名卷 `projectai-staging-postgres`；应用和 operations 容器只能通过该网络访问数据库。

`.env.auth-staging` 是 Compose 插值来源，不等于每个容器的运行时环境。Compose 按最小权限显式传值：PostgreSQL 只得到 `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`；operations 容器得到 Migration/Seed 所需的数据库、认证和 Seed 变量；应用只得到 `DATABASE_URL`、Better Auth/Cookie 配置、运行参数和公开构建元数据，不得到 Seed 密码或 `POSTGRES_PASSWORD`。

## Staging 部署

使用 `scripts/deploy-staging.sh`。脚本要求分支 `agent/auth-project-isolation`、干净工作区和完整 Commit，并执行以下受控流程：

1. 验证 SSH、无交互 sudo 和固定 canonical 目录后，以每次唯一 token 原子 `mkdir` 取得 `/srv/projectai-staging/.staging-deploy-lock`；同一时间只允许一个发布。发布目录、环境文件和备份目录不得是 symlink；环境文件必须由 root 持有、权限 `600`，每个必需 key 恰好一次，并拒绝应用/`db-tools` 镜像、健康路径、Compose 与公开构建元数据覆盖项。随后验证 Compose project、3101 端口所有者和远端 Docker 平台，并记录 Production 容器 ID、运行状态、restart count 与 health。
2. 从当前完整 Commit 的 `git archive` 构造临时发布根，只使用 Git 已跟踪文件在本地按远端 Linux 平台构建应用与 `db-tools` 镜像；不得在共享 Production 主机执行应用构建。发布内容拒绝真实 `.env`、私钥类路径，远端 `.env.auth-staging`、`backups/`、部署锁和事务标记均受保护。
3. 本地通过 `docker save` 将两个镜像流式传输给远端 `docker load`，逐一核对 image ID 与 OS/architecture；事务标记在首次远端 release 变更前创建。远端 Compose 只允许 `--no-build` 使用预加载镜像。已有 PostgreSQL 必须严格使用 `volume|projectai-staging-postgres|/var/lib/postgresql/data`，否则在任何 `compose up` 前失败关闭；随后启动独立 PostgreSQL 并等待 Healthy。
4. 在任何 Migration 前查询数据库大小并检查文件系统余量，将 custom-format `pg_dump` 直接流式写入 root-only `.partial` 文件；必须通过非空检查和同版本 `pg_restore --list` 完整性解析后才原子改名。脚本自动清理严格命名的遗留 partial 并保留最近 10 份。随后由短生命周期 operations 容器以预加载镜像执行已提交 Migration 和 insert-only 幂等 Seed，不 reset、复活身份、覆盖已有业务字段或清空 Volume。
5. 记录上一 Staging 容器实际使用的 immutable image ID 并启动新应用；`/api/health` 必须证明 PostgreSQL 可连接且 `users`、`sessions`、`projects`、`project_members` 可查询。上游先验证匿名重定向、登录、Session 刷新/退出、Manager A 跨项目拒绝、Viewer 只读、Admin 全项目与 Cookie 属性；`PUBLIC_VALIDATION=1` 时还必须通过公开 Staging URL 再执行同一套完整身份、Session、角色和项目隔离验证，并检查静态资源 MIME 与 noindex。
6. 脚本只执行 `nginx -t`，不编辑或 reload Nginx；公网验证后、清除事务标记前再次精确比对 Production 容器状态并检查 Production URL。事务标记建立后的任一步失败都会使用上一 immutable image ID 自动回滚 Staging 应用并核对实际镜像；没有上一镜像时必须确认失败应用已停止。发布前 dump 和数据库卷保留，成功/回滚后才清除事务标记并释放部署锁。

首次 Nginx 尚未接入时可用 `PUBLIC_VALIDATION=0` 只完成上游验收；Nginx 安全接入后必须按默认 `PUBLIC_VALIDATION=1` 再执行完整公网验证。

服务器不得保存个人 GitHub Token。部署失败不得删除或重新创建 `projectai-staging-postgres`。Production baseline 采集完成后的成功、失败和自动回滚路径都由 EXIT 检查比对容器 ID、运行状态、restart count 与 health；更早的 SSH、锁或受保护环境预检失败尚未进入发布事务，只会安全释放已取得的锁。

## 数据库 Migration、备份与恢复

- `npm run db:migrate` 只应用 `drizzle/` 中已提交的 forward Migration；部署脚本不会执行 schema push 或自动 down migration。
- `npm run db:seed` 是 insert-only 幂等初始化，不重置已有身份状态、角色、项目字段、成员关系或 credential，也不能代替数据库备份。
- 部署脚本每次 Migration 前自动把逻辑备份流式写到 `/srv/projectai-staging/backups/`；目录为 root-only `0700`，dump 为 root-owned `0600`，文件名包含 UTC 时间与完整部署 Commit。脚本先按数据库大小预留安全空间，以 `.partial` 写入，通过非空和 `pg_restore --list` 检查后原子改名，并只删除超出最近 10 份范围且严格匹配 Staging 命名规则的旧 dump。
- 脚本在数据库容器内使用其环境变量生成 custom-format dump，不把密码拼到命令行或日志。下面仅是等价的人工审计示例，不是正常发布前需要重复执行的步骤：

```bash
set -o pipefail
sudo install -d -m 0700 /srv/projectai-staging/backups
sudo docker exec project-ai-os-staging-postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  | sudo tee /srv/projectai-staging/backups/projectai-staging-<UTC>-<commit>.dump >/dev/null
sudo chmod 600 /srv/projectai-staging/backups/projectai-staging-<UTC>-<commit>.dump
sudo test -s /srv/projectai-staging/backups/projectai-staging-<UTC>-<commit>.dump
sudo cat /srv/projectai-staging/backups/projectai-staging-<UTC>-<commit>.dump \
  | sudo docker exec --interactive project-ai-os-staging-postgres \
      pg_restore --list >/dev/null
```

恢复必须先停止 Staging 应用、保留当前失败库快照，再在隔离维护窗口中使用同版本 PostgreSQL 工具执行 `pg_restore --clean --if-exists`；恢复后重新运行 `/api/health` 和身份边界验证。自动应用镜像回滚不会自动恢复数据库。不得对 Production 使用 Staging dump。

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
http://127.0.0.1:3101/tool/projectai-staging/api/health
http://127.0.0.1:3101/tool/projectai-staging/login
```

健康端点只在数据库连接成功且四张身份/项目核心表可查询时返回 `{"status":"ok"}`，异常时返回不含内部细节的 `503`。匿名访问 dashboard/projects/项目深层路由必须跳转登录。还要检查登录、刷新 Session、退出撤销、Manager A 只见项目 A/访问项目 B 404、Viewer 只读、Admin 见 3 个项目、Cookie Secure/Path、数据库和应用 Healthy、CSS/JS/font/favicon/OG、noindex、STAGING 元数据与 Nginx 无新增错误。同时验证 Production 首页和 dashboard，并比对 Production 容器 ID/状态/restart count/health。

## 回滚

1. 自动路径：替换应用后若本地或公网验收失败，EXIT trap 读取发布事务标记并以 `STAGING_APP_IMAGE` 恢复发布前容器记录的 immutable image ID；不依赖数据库的历史镜像必须达到 Healthy 且登录页可访问，配置过 `DATABASE_URL` 的历史镜像还必须同时满足 PostgreSQL Healthy 和 `/api/health` 数据库检查，避免把数据库故障误报为回滚成功。没有上一镜像时停止失败应用，保留 PostgreSQL。
2. 自动回滚失败时事务标记会保留，必须停止继续发布并人工检查；不得绕过标记强行覆盖。
3. 如果新 Migration 向后兼容，只保持/恢复上一应用镜像，不修改数据库；如果不兼容，先保存失败库 dump，再按上节从自动生成的发布前 dump 人工恢复 Staging 数据库。
4. 人工恢复时，受保护的 `.env.auth-staging` 必须留在固定目录且保持 mode 600；使用固定 Compose project `projectai-staging` 启动数据库/应用，重新执行 `/api/health` 和身份边界验收。
5. 只有实际改过 Nginx 才恢复时间戳备份；必须先 `nginx -t`，成功后才能 reload。
6. 重新验证 Staging 和 Production，并确认 Production 容器标识、运行状态、健康与 restart count 未变化。

禁止用 `docker compose down -v`、删除命名卷或测试 Reset 作为回滚。若 Staging 是首次部署且无上一应用版本，停止并移除应用容器即可，数据库卷保留供调查；Production 不参与回滚。

## 日志

- Staging：`docker compose -p projectai-staging -f /srv/projectai-staging/docker-compose.staging.yml logs --tail=200`。
- PostgreSQL：只查看必要时间窗和健康状态；不要执行会显示完整环境变量的 `docker inspect`/`env` 日志采集。
- Nginx：只检查本次请求时间窗，避免把历史错误误判为当前回归。
- 日志不得输出密钥、文件内容或客户资料。

## 当前发布状态

v0.3 Compose、Migration/Seed 和部署验证脚本已经实现，但截至 2026-07-14 尚未执行本分支 Staging 部署。0.2 的在线 Staging、容器或 Nginx 证据不能标记 v0.3 通过；以 `MVP_STATUS.md` 最近验证为准。
