# linkmark · 极简书签管理器

用户注册 / 登录后收藏网页链接、打标签，并按标签与关键词搜索自己的书签。
四个角色（架构师 / 后端开发 / 前端开发 / 运维）按同一份权威契约协同实现。

**权威契约**：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（主契约）、
[`db/init.sql`](db/init.sql)（唯一权威 DDL）、[`docs/DECISIONS.md`](docs/DECISIONS.md)
（架构裁决与 delta 对齐表）。冲突时以主契约为准。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite 5（纯 JSX，构建产物 `dist/`） |
| 后端 | Node 20 + Express 4 + `pg` 原生参数化 SQL，无 ORM |
| 认证 | JWT HS256 / 7d / Bearer + bcryptjs（cost 10） |
| 数据库 | PostgreSQL 16（`postgres:16-alpine`） |
| Web / 反代 | nginx:alpine（静态 `dist/` + `/api` 反代到 `backend:3000`） |
| 编排 | Docker Compose v2 |

## 目录布局（契约 §8）

```
linkmark/
├── docs/ARCHITECTURE.md   # 架构师 · 主契约
├── docs/DECISIONS.md      # 架构师 · 裁决与对齐表
├── db/init.sql            # 架构师 · 唯一权威 DDL（运维挂载首次启动执行）
├── backend/               # 后端开发 · Express API + Dockerfile
├── frontend/              # 前端开发 · React/Vite + 多阶段 Dockerfile（内置 nginx.conf）
├── docker-compose.yml     # 运维 · db / backend / web 三服务
├── .env.example           # 运维 · 环境变量样例
└── README.md              # 本文档
```

各角色只维护自己负责的目录；Schema 变更由架构师统一修订 `db/init.sql`。
**后端不自动建表**，`updated_at` 由后端在 UPDATE 语句中 `now()` 维护。

## 数据模型（严格三表）

`users 1─N bookmarks 1─N tags`：标签是书签的子行（`tags.bookmark_id` 外键，
`UNIQUE(bookmark_id, name)`），不引入第 4 张关联表。主键统一 `UUID gen_random_uuid()`，
JSON 中 id 为字符串。标签按用户隔离，写入时 `trim` + 小写 + 去空 + 去重（单个 ≤32 字符、
单书签 ≤20 个）。

## API（base `/api`）

除注册 / 登录 / `/api/health` 外一律需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | `{username,email,password≥8}` → `201 {token,user}` |
| POST | `/api/auth/login` | `{email,password}` → `200 {token,user}` |
| GET | `/api/auth/me` | 当前用户 |
| GET | `/api/bookmarks` | 列表；`q`（title/url/description ILIKE）+ `tag`（AND） |
| GET | `/api/bookmarks/:id` | 单个 |
| POST | `/api/bookmarks` | 新建 |
| PUT | `/api/bookmarks/:id` | 全量替换（含 tags 整体替换），`title` 必填 |
| DELETE | `/api/bookmarks/:id` | `204`，级联清 tags |
| GET | `/api/tags` | `{ "tags": [...] }` 去重升序 |

统一错误体 `{ "error": { "code", "message" } }`。**所有权不变量**：所有查询带
`user_id = JWT.sub`，他人 / 不存在的资源一律 `404`（不返回 403）。详见主契约 §5。

## 一键启动

```bash
cp .env.example .env      # 按需改 POSTGRES_* / JWT_SECRET / WEB_PORT
docker compose up --build
# 浏览器打开 http://localhost:8080
```

- 仅 `web` 对宿主机暴露 `${WEB_PORT:-8080}:80`；`backend`(`3000`) 与 `db`(`5432`)
  只在 Compose 内网可达。浏览器永远同源访问 `/` 与 `/api`。
- `db/init.sql` 由官方镜像在数据卷首次为空时执行；`depends_on: db(service_healthy)`
  保证 db 就绪后再起 backend。
- `/api/health` 可作为 backend healthcheck。

环境变量（`.env.example`）：`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、
`JWT_SECRET`（后端缺此变量拒绝启动）、`JWT_EXPIRES_IN=7d`、`WEB_PORT=8080`。

## 验证状态

- 后端：`cd backend && npm test` → pg-mem 端到端 **17/17 通过**
  （注册/登录/me、CRUD、q+tag AND、所有权 404、tags 全量替换、级联删除、错误体、UUID/ISO 时间）。
- 前端：`cd frontend && npm run build` → Vite 构建通过（39 modules）。
- 编排：`docker compose config` 校验通过。
- 全链路：四角色产物按本布局组装后，同源端口跑通
  静态页 / SPA 回退 → `/api/health` → 注册登录 → 带标签 CRUD → 筛选 → 标签列表 →
  PUT/DELETE → 所有权 404，全部 PASS。
- 验收清单第 5 项（前端三页浏览器点验）与第 6 项（Compose 一键拉起）需在能访问
  Docker Hub 的机器上完成：构建机曾因 Docker Hub 不可达拉不到
  `node:20-alpine` / `postgres:16-alpine` / `nginx:alpine` 而未能执行 `up --build`。

## 已知约束与待办

- 严格三表模型是 DECISIONS.md §7 的可推翻项；若负责人改回四表多对多，由架构师统一修订
  三份契约后全员同步，勿混用两套模型。
- 不做分页 / 软删除 / 标签管理页 / 分享 / 刷新令牌（契约「极简」硬约束）。
