# API 契约

- Base：`/api`
- 编码：请求/响应均为 `application/json; charset=utf-8`
- 认证：除注册、登录、健康检查外，所有接口需请求头 `Authorization: Bearer <token>`
- 错误：统一 `{ "error": "错误说明" }`，配合相应 HTTP 状态码
- 时间字段：`created_at` / `updated_at` 为数据库时间戳

## 数据对象

```json
// user
{ "id": 1, "username": "alice", "created_at": "2026-11-12T12:00:00.000Z" }

// bookmark
{
  "id": 1,
  "url": "https://example.com",
  "title": "Example",
  "description": "",
  "tags": ["work", "read"],
  "created_at": "2026-11-12T12:00:00.000Z",
  "updated_at": "2026-11-12T12:00:00.000Z"
}

// tag
{ "id": 3, "name": "work", "count": 2 }
```

## 认证

### POST /api/auth/register
注册并直接返回 token（无需再登录一次）。

请求：
```json
{ "username": "alice", "password": "secret123" }
```
- `username`：3–50 字符，trim 后存储，全局唯一
- `password`：至少 6 字符

响应 `201`：
```json
{ "token": "<jwt>", "user": { "id": 1, "username": "alice", "created_at": "..." } }
```
错误：`400` 参数不合法、`409` 用户名已存在。

### POST /api/auth/login
请求：`{ "username": "alice", "password": "secret123" }`
响应 `200`：`{ "token": "<jwt>", "user": {...} }`
错误：`400` 参数不合法、`401` 用户名或密码错误。

### GET /api/auth/me
需鉴权。响应 `200`：`{ "user": {...} }`。用于前端刷新后恢复登录态。
错误：`401` token 缺失/无效/过期。

## 书签

### GET /api/bookmarks
列出当前用户的书签（按 `created_at DESC`）。

Query 参数（可组合，AND 关系）：

| 参数 | 含义 |
|---|---|
| `tag` | 精确匹配标签名（后端会小写化）；只返回带该标签的书签 |
| `q` | 关键词，忽略大小写模糊匹配 `title` / `url` / `description` |

示例：`GET /api/bookmarks?tag=work&q=docs`

响应 `200`：
```json
{ "bookmarks": [ { "id": 1, "url": "...", "title": "...", "description": "", "tags": ["work"], "created_at": "...", "updated_at": "..." } ] }
```

### POST /api/bookmarks
请求：
```json
{
  "url": "https://example.com",       // 必填，合法 http/https 地址
  "title": "Example",                  // 可选，缺省用 url
  "description": "备注",               // 可选，缺省 ""
  "tags": ["work", "read"]            // 可选，字符串数组；trim+小写、去重
}
```
响应 `201`：`{ "bookmark": {...} }`
错误：`400` 字段不合法、`401` 未鉴权。

### GET /api/bookmarks/:id
响应 `200`：`{ "bookmark": {...} }`
错误：`404` 不存在或不属于当前用户、`401` 未鉴权。

### PUT /api/bookmarks/:id
只更新提供的字段；**若提供 `tags` 则整体替换标签**（传 `[]` 清空）。

请求（字段均可选）：
```json
{ "title": "New Title", "url": "https://new.example.com", "description": "...", "tags": ["work"] }
```
响应 `200`：`{ "bookmark": {...} }`
错误：`400` 字段不合法、`404` 不存在或不属于当前用户。

### DELETE /api/bookmarks/:id
响应 `204`（无 body）。关联标签关系级联删除。
错误：`404` 不存在或不属于当前用户。

## 标签

### GET /api/tags
列出当前用户的所有标签及引用计数（含 `count = 0` 的历史标签），按名称排序。

响应 `200`：
```json
{ "tags": [ { "id": 3, "name": "work", "count": 2 } ] }
```

## 健康检查

`GET /api/health` 或 `GET /health` → `200 { "status": "ok" }`，无需鉴权。

## 状态码总览

| 状态码 | 含义 |
|---|---|
| 200 / 201 / 204 | 成功 / 创建 / 删除 |
| 400 | 请求参数或 JSON 不合法 |
| 401 | 未登录 / token 无效 / 用户名密码错误 |
| 404 | 资源不存在或不属于当前用户、未知路由 |
| 409 | 用户名冲突 |
| 500 | 服务器内部错误 |
