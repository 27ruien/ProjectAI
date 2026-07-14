# Project AI OS MVP Spec

## 第一阶段产品定义

核心用户：项目经理。

核心问题：

1. 项目经理写文档耗时太长。
2. 项目信息分散，查找困难。
3. 需求经常遗漏、重复或理解错误。

## 需要验证的 MVP 主流程

```text
登录
→ 服务端建立数据库 Session
→ 查询当前用户可访问项目
→ 创建项目
→ 上传项目资料
→ 系统解析资料
→ 项目知识问答
→ 返回来源引用
→ AI 提取结构化需求
→ 项目经理修改
→ 提交人工审核
→ 审核通过
→ 写入正式需求列表
```

该流程的价值不是“展示 AI”，而是缩短项目经理整理资料、编写需求和追溯依据的时间，同时保留人工决策权。

v0.3 只把主流程的可信入口和项目数据边界真实化：账号预创建、登录/退出、数据库 Session、项目及成员关系、服务端授权、项目基础信息和审计。上传之后的链路仍不是真实业务能力。

## v0.3 身份与项目隔离范围

- PostgreSQL + Drizzle Schema/Migration。
- Better Auth `1.6.23` 邮箱密码认证，不开放公共注册、找回密码或社交登录。
- 密码使用认证库的安全哈希；credential hash 规范化存放于 `accounts.password_hash`，`users` 不保存重复密码字段。
- Session 持久化到 PostgreSQL，通过按环境和 basePath 隔离的 HttpOnly Cookie 传递。
- 系统角色：`system_admin`、`standard_user`。
- 项目角色：`project_manager`、`project_member`、`viewer`。
- 项目列表、创建、基础信息、成员关系和审计事件使用数据库 Repository。
- 页面与 API 统一从服务端 Session 和项目成员关系授权；不存在和无权限项目统一 404 并记录拒绝审计。
- 项目业务 Mock 必须在授权后由服务端按精确 `projectId` 过滤，不能把完整数据发到客户端再隐藏。
- CI 使用独立 PostgreSQL Service；Staging 使用不发布端口的独立 PostgreSQL 容器和命名卷。

## 当前 Mock 范围

以下能力目前仅为交互演示或内存 Mock，不可当作真实业务能力：

- 文件上传、文件持久化和文档解析。
- 知识检索、AI 回答和模型调用。
- 需求提取和审核写入；只有身份/项目相关审计已持久化，AI execution 与业务审核日志仍为 Mock。
- Scope、Action Plan、风险分析和会议处理。

真实化能力为用户、credential、Session、登录频率限制、项目、项目成员关系、项目基础信息和身份/项目审计。当前 Mock 必须继续遵循正式架构契约：服务端项目授权和过滤、来源引用、有效版本、AI 草稿、人工审核、正式数据相互分离。

## 下一阶段真实化顺序

```text
已完成身份认证、项目权限和 PostgreSQL 基础
→ 通过 v0.3 产品/安全审查
→ 对象存储
→ 文件解析
→ 项目 RAG
→ AI 需求提取
→ 人工审核
→ 正式需求写入
```

在 v0.3 的 CI、Staging 与安全审查全部完成前，仍禁止使用真实客户资料进行试用。

## 本轮范围

本轮只建设 `Project AI OS v0.3 — Identity and Project Isolation`：正式认证、PostgreSQL、数据库 Session、项目成员关系、项目级服务端授权、跨项目测试、Staging 数据库和 CI 产品审查 artifacts。

本轮不得接入真实上传、对象存储、解析/OCR、Embedding、pgvector、检索/RAG、Reranker、真实模型、Provider Key、公开注册、找回密码或社交登录。Production 不在本轮部署范围。
