# 架构裁决与并行实现对齐（架构师 · v1.1）

> 本文件与 `ARCHITECTURE.md`、`db/init.sql` 同为权威契约的一部分；冲突时以
> `ARCHITECTURE.md` 为准，本文件记录裁决与对齐要求。

## 1. 背景

架构师此前两轮 run 分别因「缺 API key」「被取消」失败，后端开发在另一会话中据此判断「无契约」，
自行补齐了一份 `docs/ARCHITECTURE.md` + `docs/API.md`（事实契约，标注「待架构师确认」），
并实现了后端：Node20 + Express4 + pg，JWT + bcryptjs，CORS，`/api/health`，启动时幂等建表，
pg-mem 端到端测试 1/1 通过，声称已推到 `main`(9793f39)。其数据模型为 **4 张表**
（users / bookmarks / tags / **bookmark_tags** 多对多关联表）。

后端开发已明确声明「若架构师后续给出不同约定，以其为准并同步修订」。故本文件给出正式裁决。

**裁决：以架构师 `ARCHITECTURE.md` + `db/init.sql` 为唯一权威契约。**
后端开发的事实契约作废（避免四角色出现两套技术栈 / Schema / API）。后端已有实现尽量复用，
按下表 delta 修订即可，认证与 CRUD 主体无需重写。

## 2. 对后端 4 个待确认问题的答复

1. **技术栈** —— 确认 Node20 + Express4 + PostgreSQL，`pg` 原生参数化 SQL、无 ORM。✅ 一致。
2. **认证** —— **JWT**（HS256，7d，Bearer），无状态；不用 Session/Cookie。✅ 一致。
3. **标签是否跨用户共享** —— **不共享、按用户隔离**。主契约里 tags 是 bookmarks 子行，天然按用户隔离；不做全局标签表。
4. **分页 / 软删除 / 分组等** —— **都不做**，保持「极简」。✅ 一致。

## 3. 必须对齐的差异（后端开发）

| # | 项 | 后端现状 | 权威契约 | 处理 |
|---|---|---|---|---|
| 1 | 表数量 | 4 表，含 `bookmark_tags` | **3 表**：users / bookmarks / tags | **改**。任务明确要求三张表；tags 用 `bookmark_id` 外键作子行（users 1─N bookmarks 1─N tags），移除关联表 |
| 2 | 主键 | `int` 自增 | `UUID gen_random_uuid()` | **改**。与 `db/init.sql` 一致，JSON 中 id 为字符串 |
| 3 | 用户字段 | 仅 `username` | `username` + `email` | **改**。注册/登录按 `email`；保留 username 展示 |
| 4 | 密码长度 | ≥6 | ≥8 | 改 |
| 5 | Schema 来源 | 启动幂等 `CREATE TABLE` | **`db/init.sql` 由运维挂载** | **改**。后端不建表/改表；`updated_at` 在 UPDATE 里 `now()` |
| 6 | 端口 / 服务名 | `3001` / `api` | `3000` / `backend` | 改（Compose 与 env 同步） |
| 7 | PG 版本 | 15 | 16-alpine | 改镜像 tag（运维负责） |
| 8 | 错误体 | `{ "error": "字符串" }` | `{ "error": { "code", "message" } }` | 改，全端点统一 |
| 9 | `GET /api/tags` | `[{id,name,count}]` | `{ "tags": ["name", ...] }` | 改；返回去重标签名升序 |
| 10 | PUT 语义 | 局部更新 | 全量替换（含 tags 整体替换） | 改 |
| 11 | `title` | 可省略，缺省 url | 必填非空 | 改 |
| 12 | CORS | 开启 | 生产 nginx 同源反代可不需要 | **可保留**（无害）；开发期由 Vite proxy 解决跨域 |
| 13 | `/api/health` | 有 | 主契约未列 | **可保留**，供 Compose healthcheck |

API 端点集合、Bookmark JSON 结构（含 `tags` 字符串数组）、`q`+`tag` 组合筛选（AND）、
所有权不变量（`user_id = JWT.sub`、他人资源 404）三者**两版一致，保持不变**。
因此前端 / 运维契约不受影响，按各自 brief 开工即可。

## 4. 修订后的标签读写（后端）

- 新建 / 更新书签：单事务内 `DELETE FROM tags WHERE bookmark_id=$1` → 批量 `INSERT` 规范化后的名字。
- 规范化：`trim` + 小写 + 去空 + 去重，单标签 ≤32 字符，单书签 ≤20 个。
- 按标签筛选：`SELECT DISTINCT b.* FROM bookmarks b JOIN tags t ON t.bookmark_id=b.id
  WHERE b.user_id=$1 AND t.name=$2`。
- 标签列表：`SELECT DISTINCT name FROM tags t JOIN bookmarks b ON b.id=t.bookmark_id
  WHERE b.user_id=$1 ORDER BY name`。
- 关键词：`title/url/description ILIKE '%q%'`；与 tag 条件 AND。

## 5. 给运维的连带约定

- `db` 服务挂载 `./db/init.sql` → `/docker-entrypoint-initdb.d/`；因后端不再自建表，**这一步是必需项**。
- `backend` 服务名、`3000` 端口、`postgres:16-alpine` 镜像按主契约。
- `/api/health` 可作为 backend 的 healthcheck（若后端保留该端点）。

## 6. 环境与交付

本机 github.com 不可达，`hifox repo checkout / push` 在架构师本轮不可用（缓存无 refs、本地 repo 服务超时）。
契约与产物改由**任务附件 + 各会话 artifact** 交付。请各角色只写自己负责的目录。

## 7. 可由负责人推翻的一点

第 1 项「严格三张表」是为贴合任务「users、bookmarks、tags 三张表」的字面要求。
若负责人更认可后端已实现的 4 表多对多模型，请告知架构师，我会把 `ARCHITECTURE.md`、
`db/init.sql`、`DECISIONS.md` 统一改成「三张实体表 + 一张关联表」版本并通知前端 / 运维——
**在负责人拍板前，一律按三表契约执行**，不要混用两套模型。
