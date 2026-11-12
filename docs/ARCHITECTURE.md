# 架构契约（Architecture Contract）

> 状态说明：架构师的两轮 run 分别因「缺 API key」和「被取消」失败，未产出任何契约文档；仓库初始为空。
> 为让四个角色（数据库/后端/前端/运维）能对齐，本文件由后端在缺位情况下按任务描述补齐，**作为当前可执行的事实契约**，
> 标注为「待架构师 / 负责人确认」。若架构师后续给出不同约定，以其为准并同步修订本文件与 `docs/API.md`。
> 后端已按本契约实现，接口细节见 [`docs/API.md`](./API.md)。

## 1. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 数据库 | PostgreSQL 15 | 独立容器，三张业务表 + 一张关联表 |
| 后端 | Node.js 20 + Express 4 | REST API，CommonJS |
| ORM | 无（直接用 `pg` 参数化 SQL） | 保持极简、可控 |
| 认证 | JWT（`jsonwebtoken`）+ bcrypt（`bcryptjs`） | 无状态，密码仅存哈希 |
| 前端 | 由「前端开发」决定（建议纯静态 SPA / 构建产物） | 只需遵循下文 API 约定 |
| 部署 | Docker Compose（由「运维」落地） | 前端静态产物 + 后端 API + 数据库 三个服务 |

选择纯 JS 依赖（`bcryptjs`、`pg`、`pg-mem`）而非需要本地编译的原生模块，确保容器内 `npm install` 稳定。

## 2. 组件与数据流

```
浏览器 (前端静态站)
   │  HTTP + JSON，Authorization: Bearer <JWT>
   ▼
后端 API (Express, :3001)  ──参数化 SQL──►  PostgreSQL (:5432)
   │
   └─ 启动时幂等执行 db/schema.sql（CREATE TABLE IF NOT EXISTS）
```

- 前端与后端可不同源，后端已开启 CORS（开发期允许所有来源，生产可用 `CORS_ORIGIN` 收紧）。
- 运维用 Compose 时，建议用 nginx 把前端 `/api` 反代到后端，或让前端直连后端地址；二选一即可，前端只需知道「API base = `/api`」。

## 3. 数据库 Schema（`db/schema.sql`）

三张核心表 + 一张多对多关联表，关系清晰：

```mermaid
erDiagram
  USERS ||--o{ BOOKMARKS : "user_id 拥有"
  USERS ||--o{ TAGS : "user_id 拥有"
  BOOKMARKS ||--o{ BOOKMARK_TAGS : "bookmark_id"
  TAGS ||--o{ BOOKMARK_TAGS : "tag_id"
  USERS {
    int id PK
    text username UK
    text password_hash
    timestamp created_at
  }
  BOOKMARKS {
    int id PK
    int user_id FK
    text url
    text title
    text description
    timestamp created_at
    timestamp updated_at
  }
  TAGS {
    int id PK
    int user_id FK
    text name
  }
  BOOKMARK_TAGS {
    int bookmark_id PK_FK
    int tag_id PK_FK
  }
```

| 表 | 关键字段 | 约束 |
|---|---|---|
| `users` | `id, username, password_hash, created_at` | `username UNIQUE` |
| `bookmarks` | `id, user_id, url, title, description, created_at, updated_at` | `user_id → users.id ON DELETE CASCADE` |
| `tags` | `id, user_id, name` | `UNIQUE(user_id, name)`；标签按用户隔离 |
| `bookmark_tags` | `bookmark_id, tag_id` | 联合主键；两侧 `ON DELETE CASCADE` |

约定：
- 一个用户拥有多个书签、多个标签；书签与标签是多对多。
- 标签名统一 **trim + 小写**（`toLowerCase`），后端自动去重。
- 删除书签时，关联关系由外键级联清理；`tags` 表保留用户用过的标签（`/api/tags` 列出），`count` 为引用它的书签数，可为 0。

## 4. 环境变量（`.env.example`）

| 变量 | 默认值 | 用途 |
|---|---|---|
| `PORT` | `3001` | 后端监听端口 |
| `DATABASE_URL` | `postgres://linkmark:linkmark@localhost:5432/linkmark` | PG 连接串；Compose 内 host 用服务名 `db` |
| `JWT_SECRET` | 开发用不安全默认值 | JWT 签名密钥，生产必须覆盖 |
| `CORS_ORIGIN` | `*`（开发期允许所有） | 允许的跨域来源 |

## 5. 运维 / Docker 约定（供「运维」落地 Compose）

预期三个服务：

| 服务 | 镜像/构建 | 端口 | 说明 |
|---|---|---|---|
| `db` | `postgres:15-alpine` | 内部 5432 | `POSTGRES_USER/PASSWORD/DB = linkmark/linkmark/linkmark`，挂 volume 持久化 |
| `api` | 本目录 `Dockerfile`（`node:20-alpine`） | 3001 | `depends_on: db`（建议带 healthcheck 等待 db 就绪）；注入 `DATABASE_URL`、`JWT_SECRET` |
| `web` | 前端构建产物（nginx） | 80 | 静态站；`/api` 反代到 `api:3001`（同源）或直接指向后端地址 |

- 后端**启动即幂等建表**，因此对数据库启动慢有约 15 秒的重试容忍，数据库容器无需预挂初始化脚本（可选把 `db/schema.sql` 放进 `/docker-entrypoint-initdb.d/`）。
- 健康检查：`GET /api/health` 或 `GET /health` → `200 {"status":"ok"}`，无需鉴权，可直接用于 Compose `healthcheck`。
- 本仓库已提供后端 `Dockerfile` 与 `.dockerignore`，运维只需编排，不必改后端代码。

## 6. 前端约定（供「前端开发」落地页面）

- API base：`/api`（所有接口前缀）。
- 认证：`POST /api/auth/register|login` 返回 `{ token, user }`；之后每个请求带 `Authorization: Bearer <token>`；可用 `GET /api/auth/me` 恢复登录态。
- 页面：登录/注册页、书签列表页（支持按标签/关键词筛选）、添加/编辑表单。
- 字段完整定义、请求/响应示例见 [`docs/API.md`](./API.md)。

## 7. 待确认事项（交给架构师 / 负责人）

1. 技术栈是否与预期一致（Node+Express+Postgres）；如需换语言/框架需整体返工。
2. 认证是否接受 JWT（还是 Session/Cookie）。
3. 标签是否要跨用户共享（当前按用户隔离）。
4. 是否需要分页、软删除、收藏夹/分组等超出「极简」范围的能力。
