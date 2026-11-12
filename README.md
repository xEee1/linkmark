# linkmark · 极简书签管理器（后端）

四角色协作中的**后端**部分：认证 + 书签 CRUD + 按标签/关键词筛选 + 数据库交互。
技术栈契约、数据库 ERD、环境变量与 Docker 约定见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，
完整接口定义见 [`docs/API.md`](docs/API.md)。

## 目录

```
db/schema.sql        数据库 DDL（users / bookmarks / tags / bookmark_tags）
src/db.js            连接池 + 幂等迁移（启动即建表）
src/auth.js          注册/登录/me + JWT 鉴权中间件
src/bookmarks.js     书签 CRUD、标签/关键词筛选、标签列表
src/app.js           Express 应用装配（CORS / JSON / 路由 / 错误处理）
src/server.js        启动入口
test/api.test.js     端到端测试（pg-mem 内存 Postgres，无需真实数据库）
Dockerfile           后端镜像
docs/                架构契约与 API 契约
```

## 本地运行

需要可达的 PostgreSQL（或用 Docker 起一个）：

```bash
cp .env.example .env        # 按需修改 DATABASE_URL / JWT_SECRET
npm install
npm start                   # http://localhost:3001/api/health
```

后端启动时会**自动幂等建表**（`CREATE TABLE IF NOT EXISTS`），无需手动执行 SQL。

## 测试

```bash
npm test
```

测试用 `pg-mem`（纯 JS 内存版 Postgres）通过 `pg` 适配器驱动真实 Express 应用与 SQL，
覆盖注册/登录/鉴权、书签增删改查、标签与关键词筛选、以及多用户数据隔离，无需外部数据库。

## 验证过的接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 当前用户 |
| GET/POST | `/api/bookmarks` | 列表（可带 `tag` / `q`）/ 新建 |
| GET/PUT/DELETE | `/api/bookmarks/:id` | 详情 / 编辑 / 删除 |
| GET | `/api/tags` | 标签及计数 |
| GET | `/api/health` | 健康检查 |
