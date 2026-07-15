# Deployment

## 环境矩阵

| 环境 | URL / basePath | 目录与应用 | PostgreSQL | Object Storage | 宿主机端口 |
| --- | --- | --- | --- | --- | --- |
| Production | https://gridworks.cn/tool/projectai/ / `/tool/projectai` | `/srv/projectai` / `project-ai-os` | 既有环境，本轮不得修改 | v0.4 不增加 | `127.0.0.1:3100` |
| Staging | https://gridworks.cn/tool/projectai-staging/ / `/tool/projectai-staging` | `/srv/projectai-staging` / `project-ai-os-staging` | `project-ai-os-staging-postgres` + `projectai-staging-postgres` | `project-ai-os-staging-minio` + `projectai-staging-minio` + `projectai-staging-files` | 应用 `127.0.0.1:3101`；DB/MinIO 无端口 |

v0.4 只允许部署 Staging。不得在 Production 主机构建、迁移、重启、增加对象存储、修改环境或重新部署。

## Staging 构建元数据

```env
NEXT_PUBLIC_BASE_PATH=/tool/projectai-staging
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_APP_VERSION=0.4.0-staging
NEXT_PUBLIC_COMMIT_SHA=<feature branch full sha>
NEXT_PUBLIC_BUILD_TIME=<ISO-8601>
AI_PROVIDER=mock
```

环境条必须显示 build 元数据以及“文件真实存储；解析和 AI 知识索引未启用”。robots 与 Nginx header 均设置 noindex。认证配置继续使用完整 Staging `BETTER_AUTH_URL`、独立 `AUTH_COOKIE_PREFIX` 和 `/tool/projectai-staging` Cookie Path；Cookie 必须 HttpOnly、SameSite=Lax、Secure。

## 受保护环境文件

服务器实际值只保存在 `/srv/projectai-staging/.env.auth-staging`：

- 普通文件、非 symlink，`root:root 600`；部署/rsync 不覆盖、不移动、不打印。
- PostgreSQL、`DATABASE_URL`、Better Auth、Cookie/Origin、5 个 Seed 身份。
- `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`，以及不同的 `OBJECT_STORAGE_ACCESS_KEY` / `OBJECT_STORAGE_SECRET_KEY`。
- 固定内部 Endpoint `http://projectai-minio:9000`、region `us-east-1`、Bucket `projectai-staging-files`、path-style true、SSL false。
- `MAX_UPLOAD_BYTES=52428800` 与 `UPLOAD_ALLOWED_EXTENSIONS=pdf,docx,xlsx,pptx,txt,md`。

真实 credential 不进入示例、Git、镜像层、日志或 Artifact。MinIO root/app credential 必须满足长度/字符规则且互不相同。

`.env.auth-staging` 是 Compose 插值来源，不代表完整注入每个容器：

- PostgreSQL 只接收自身初始化变量。
- MinIO server 只接收 root credential。
- init 任务短期得到 root + app credential，创建私有 Bucket、应用用户和 `projects/*` 最小权限策略。
- App 只接收 `DATABASE_URL`、认证运行参数和 app-level object credential，不接收 PostgreSQL 密码、Seed 密码或 MinIO root credential。
- Migration 与 storage operations 使用独立短生命周期 Compose service，各自只获取任务需要的变量。

## Staging MinIO

Compose 固定：

```text
service: projectai-minio
container: project-ai-os-staging-minio
volume: projectai-staging-minio:/data
network: projectai-staging-internal
bucket: projectai-staging-files
published ports: none
```

镜像固定到已审查 release，不使用 `latest`。健康检查只访问容器内 `/minio/health/live`。`projectai-minio-init` 必须幂等执行：创建 Bucket、明确关闭 anonymous policy、创建/复用应用用户、绑定只允许该 Bucket 和 `projects/*` 对象操作的 policy，再用应用账号验证访问；任何步骤失败使部署失败关闭。

数据卷不得在普通部署/回滚删除，部署脚本不得出现 `docker compose down -v`。MinIO API 与 Console 都不通过 Nginx 或宿主机端口暴露。

## Staging 部署流程

使用 `scripts/deploy-staging.sh`。脚本要求：

- 分支精确为 `agent/project-files-foundation`，工作区 clean，完整 40 位 Commit。
- 固定 Compose project `projectai-staging`、目录 `/srv/projectai-staging` 和远端平台。
- 原子取得 Staging 专属部署锁；发布目录、环境、备份、锁和 marker 均不得是 symlink。
- 记录 Production 容器 ID、running、restart count、health，进入发布事务后的成功/失败/回滚出口都必须精确一致。

受控顺序：

1. 使用当前 Commit 的 tracked-file `git archive` 构造临时 release；拒绝 `.env`、私钥与 reserved overrides。
2. 在本地按远端平台构建 immutable App 和 DB-tools 镜像，通过 `docker save/load` 传输并核对 image ID/OS/architecture；共享服务器不执行应用构建。
3. 拉取固定 MinIO server/client release；检查现有 PostgreSQL/MinIO 挂载必须分别为预期命名卷，MinIO 不得有 published port。
4. 启动 PostgreSQL 与 MinIO并等待 Healthy；强制重建 init 任务并等待 exit 0，失败即停止。
5. 在 rollback trap 与事务 marker 已建立后，短暂停止当前 Staging 应用，取得 PostgreSQL/MinIO 同一静默写入边界。
6. 生成并验证 PostgreSQL custom-format dump；生成 MinIO JSONL inventory 与 mirror，核对对象数和总字节，再恢复到唯一临时 Bucket 并复核/删除。
7. 使用短生命周期 migration service 应用已提交 Migration 与 insert-only Seed，不 schema push、不 reset、不覆盖身份/角色/credential，并断言每项目至少一名 Manager。
8. 用 scoped storage operations 执行 `npm run storage:verify`；任何 finding 或存储不可用都失败关闭。
9. 记录上一 App immutable image ID，启动新应用；验证 PostgreSQL/MinIO Healthy、MinIO 卷/无端口、App 健康和身份/项目边界。
10. 再次运行只读 `storage:verify`，然后执行真实上传、下载、版本/current、归档/恢复、Viewer/跨项目/拒绝和完整性冒烟。
11. 清理本次验证 Session、测试文档与对象；验证没有临时恢复 Bucket、partial backup、init 容器或部署 marker/lock 残留。
12. `nginx -t`、公网 canonical/Host/MIME/noindex 验证以及 Production 精确不变复核；脚本不自动编辑或 reload Nginx。

任一步骤失败都会触发 Staging App 镜像回滚并保留 PostgreSQL/MinIO 卷及跨存储备份。数据库或对象数据恢复不自动执行，必须人工审核。

## PostgreSQL 与 MinIO 备份

备份根 `/srv/projectai-staging/backups/` 必须 `root:root 700`；文件为 root-only，不能进入 Git、产品 Artifact 或普通日志。

### PostgreSQL

- Migration 前查询数据库大小与文件系统余量。
- `pg_dump --format=custom --no-owner --no-acl` 流式写入 `.partial`。
- 非空且同版本 `pg_restore --list` 成功后才原子改名为 `.dump`。
- 只清理严格匹配命名的 stale partial，并保留最近 10 份。

### MinIO

- 备份目录 `/srv/projectai-staging/backups/object-storage/`。
- `mc --json ls --recursive` 生成 `.inventory.jsonl.partial`；每行必须有可解析 size。
- `mc mirror --retry` 写入独立 `.mirror.partial`；文件数与字节数必须等于 inventory。
- 权限收紧后才将 inventory/mirror 原子改名；最终不得有 `.partial`。
- 恢复演练创建 `projectai-restore-*` 临时 Bucket，绝不能等于正式 Bucket；把 mirror 写入后重新 inventory，核对数/字节，再 `rb --force` 删除临时 Bucket并确认不存在。
- 对象正文、完整 Object Key 和 credential 不打印。备份只保留最近 10 组严格命名的 inventory + mirror。

应用停止保证 PostgreSQL 与 Bucket 不再有本应用写入，但两个系统没有分布式快照。若未来增加其他写入者，必须先增加统一 quiesce 协议，不能复用当前假设。

## 一致性命令

```bash
npm run storage:verify
npm run storage:reconcile
```

`storage:verify` 只读核对 stored object、size、ETag、SHA-256 metadata、单 current、active/current、stale pending 和 orphan。输出不含 Key 或 Secret。部署前后均必须为 `ok: true`。

`storage:reconcile` 默认 dry-run。apply 只能在非 Production 且同时提供 `ALLOW_STORAGE_RECONCILE_APPLY=1`、`OBJECT_STORAGE_BUCKET_CONFIRM=<exact bucket>` 和合法最小 orphan 年龄时运行；删除前再次查数据库引用。本轮正常部署不自动 apply。

## Nginx

- 只向现有 HTTPS server block 增加/维护 Staging exact/assets/general location，不代理 MinIO。
- `/tool/projectai-staging` 使用固定绝对 canonical URL，不能继承未验证 Host。
- 应用只信任受控 Nginx 覆写的 Host/协议；不匹配 Host/X-Forwarded-Host/协议统一 404。
- `client_max_body_size 52m`，为 50 MiB 文件加 multipart framing 余量；应用仍以 `MAX_UPLOAD_BYTES` 执行业务上限。
- 通用 proxy 保留 basePath；静态 location 仅剥离已知 assets 前缀。
- 修改前备份实际站点文件；只有 `nginx -t` 通过后才能 reload。部署脚本本身只测试，不 reload。
- 不修改 Production location、DNS、证书或其他服务。

## 健康与验收

```text
http://127.0.0.1:3101/tool/projectai-staging/api/health
https://gridworks.cn/tool/projectai-staging/
```

基础验收：

- App、PostgreSQL、MinIO Healthy；MinIO 固定命名卷且无端口，Bucket anonymous 请求拒绝。
- 登录/刷新/退出、Manager A/B、Member、Viewer、Admin、最后 Manager 409 和跨项目 404 回归。
- 真实上传允许类型/大小/签名，刷新持久化、下载 SHA-256、版本/current、归档/恢复、权限与对象/Session 清理。
- `storage:verify` 为零 finding；无 orphan、stale pending、临时 Bucket 或 partial backup。
- Cookie、canonical HTTPS、恶意 Host、CSS/JS/font/image MIME、noindex 和 Nginx 新错误检查。
- `/api/health` 的合法完整 `x-projectai-commit-sha` 必须等于部署 Commit。
- Production 根路径/dashboard 可用，容器 ID、running、restart count、health 与基线精确一致。

## 回滚与恢复

1. 应用替换后的失败由 EXIT trap 使用发布前记录的 immutable App image ID 自动回滚；无上一镜像则停止失败 App。
2. 自动回滚不删除或重建 `projectai-staging-postgres` / `projectai-staging-minio`，也不删除发布前 dump/inventory/mirror。
3. Migration 不兼容时，先保存失败状态，再在维护窗口使用同版本工具人工恢复 PostgreSQL；对象恢复只能先进入临时 Bucket 验证，不直接覆盖正式 Bucket。
4. 数据库与对象必须成组选择同一时间戳/Commit 的备份。只恢复一边会造成不一致，恢复后必须运行 `storage:verify` 和完整身份/文件验收。
5. 自动回滚失败时保留 marker 并停止发布，禁止绕过、`down -v`、删除卷或测试 Reset。
6. 只有实际改过 Nginx 才从时间戳备份恢复，并遵守 `nginx -t` 后 reload。

## 日志

- Staging 总览：`docker compose -p projectai-staging -f /srv/projectai-staging/docker-compose.staging.yml logs --tail=200`。
- PostgreSQL/MinIO 只检查必要健康和当前时间窗；不要记录完整 `docker inspect` 环境或 `mc alias` 配置。
- 日志不得输出文件正文、完整 Object Key、Bucket 内部地址、密码、Cookie、Session、数据库 URL 或存储凭据。

## 当前发布状态

v0.4 尚未部署。当前在线 Staging 的已知版本仍是 v0.3 Commit `ff19049deca065b3dbc4698c3a219980dcd2f47b`，不能证明 MinIO、文件 Migration、真实上传、跨存储备份或 v0.4 Production 不变。最终发布完成后必须用实际 App/DB/MinIO 状态、Bucket privacy、备份/恢复、`storage:verify`、文件流程、清理结果、运行 SHA 和 Production baseline 更新 `MVP_STATUS.md`。
