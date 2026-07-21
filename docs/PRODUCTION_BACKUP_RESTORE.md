# Production Backup and Restore

## 当前事实与 B3-C1 处理

当前 Production 只有既有 App 容器，没有可归属 ProjectAI 的 PostgreSQL、MinIO、Document Worker、Embedding Worker 或 Migration。B3-C1 因而生成脱敏 backup plan 和 `not-applicable` 数据面证据，不创建空的伪 Backup，也不接触宿主机上与本项目无关的 PostgreSQL。

Preflight 对不存在的数据面只接受显式字符串 `not-applicable`；空值、未知值或普通 `false` 仍失败。数据面一旦存在，这些门禁必须回到真实连接、目录、空间、工具和 Inventory 检查，不能继续使用 N/A。

提示词同时允许受保护 Production Backup `--apply`，又要求本轮所有 Production apply 硬禁用。实现采用更严格边界：包括 backup 在内的所有 `--environment=production --apply` 返回 `PRODUCTION_APPLY_NOT_AUTHORIZED`。真正的首次 Production Backup 只能在 B3-C2 独立授权后实现和执行。

## B3-C2 Backup 合同

前提：Production Healthy、基线精确匹配、部署/迁移锁为空、活动 Job/Execution 清零、磁盘门禁通过、备份目录规范化且可写、空间满足 `max(10 GiB, 2 × target image + DB backup + object delta + 5 GiB)`，filesystem/inode 均低于 85%。

### PostgreSQL

- 使用固定客户端版本和 custom-format logical dump；不停止或重启数据库；
- 包含 Schema、Data、Extension 与 Migration 表；`--no-owner --no-acl` 后另存角色/权限的脱敏摘要；
- 临时文件使用 `0600`，完成后原子改名；
- 记录开始/完成时间、大小、SHA-256、PostgreSQL/pgvector 版本和 Manifest ID；
- 使用 `pg_restore --list` 验证 archive 可读，再在隔离实例真实恢复；
- Backup 不上传 GitHub Artifact，不输出正文、密码、连接 URL 或 Session Token。

### MinIO

- 先生成 immutable object inventory：对象数、总大小、受控 checksum 和时间；
- 如已有经过审查的 mirror 机制，只做不删除源对象的增量 mirror；
- Inventory/镜像写入 Production 专用 root-only backup 目录，不移动或删除线上对象；
- 通过临时隔离 Bucket 抽样/全量核对对象数量、大小、checksum 与数据库引用；
- Artifact 只保存计数、大小、时长、发现和 Digest，不保存 Object Key、Bucket credential 或完整 mirror。

### 配置

保存 Compose/Nginx 文件副本与 Hash、Image/Container Inventory、健康状态、脱敏 Env key 名称和 Secret 存在性/权限摘要。不得复制 Secret 内容到普通备份集合。

## Restore Drill

隔离 Restore 必须使用独立 Compose Project、Network、Volume/Database，无公开端口、无 Production 域名、无 Production MinIO/Secret/Database 连接：

1. 校验 Backup SHA-256 和非空；
2. 恢复到新隔离 PostgreSQL；
3. 核对用户、项目、成员、Session 边界、文件记录、Audit 和关键关系计数；
4. 验证 MinIO Inventory/抽样对象及数据库引用；
5. 启动旧 App，执行既有能力 Smoke；
6. 依次执行 0004、0005、0006、0007，记录时长、锁、尺寸和失败点；
7. 验证 pgvector 0.8.1、`vector(1024)`、Profile 唯一性和无业务删除；
8. 启动新 App 全关闭，执行 Smoke；
9. 清理隔离 Container、Network、Database、Volume、虚构用户/项目/文档/Session/Job/Run 和临时文件。

当前仓库的 `release:database-rehearsal` 使用纯虚构非空数据执行 custom dump、Checksum、真实 Restore 和 0004–0007；它从不连接 Production，也不上传 dump。

## 失败与保留

Checksum、Restore、关系、权限、对象一致性、Migration 或清理任一失败即 NO-GO。失败时保留必要的脱敏诊断和受控 Backup，不自动重复 Migration，不回写 Production，不执行无范围删除。不得删除当前 Production/Staging/Target Image、任何 PostgreSQL/MinIO Volume 或最近有效 Backup。

## B3-C2A Phase 0/1 boundary

Phase 0 只在正式 B3-C2B Authorization 后创建配置备份；备份只包含 Compose/Nginx 配置和 Checksum，不包含 `.env` 或 Secret。当前 Production 数据平面不存在时 DB/Object Backup 必须是 `not-applicable`。Phase 1 Bootstrap 失败时旧 App 保持运行，新数据 Volume 保留调查，不自动删除或重试 Migration。B3-C2A 仅验证该合同和隔离 Restore/Rehearsal，不写 Production。
