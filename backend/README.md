# linkmark · backend

Express 4 REST API (Node 20 + `pg`), aligned to the architect's authoritative
contract: `docs/ARCHITECTURE.md`, `db/init.sql`, `docs/DECISIONS.md`.

> This build supersedes the earlier "fact contract" implementation. The
> architect's ruling is the single source of truth; the deltas below are applied.

## Alignment with the ruling (DECISIONS.md §3)

| # | Delta | Status |
|---|---|---|
| 1 | Three tables only; `bookmark_tags` removed; `tags.bookmark_id` FK child rows | done — all tag writes are `DELETE` + batched `INSERT` in one transaction |
| 2 | `UUID gen_random_uuid()` PKs, ids are strings in JSON | done — INSERT omits `id`, `RETURNING` yields UUID strings; `:id` validated as UUID |
| 3 | `users.email`; register/login by email; keep username for display | done — email trimmed+lowercased, `UNIQUE`; login uses email |
| 4 | password ≥ 8 | done |
| 5 | No startup DDL; schema from `db/init.sql`; `updated_at=now()` in UPDATE | done — `server.js` only opens a Pool; no `CREATE TABLE` anywhere at runtime |
| 6 | port `3000`, service `backend`, PG16 | done — listens on `process.env.PORT` (default 3000); Compose names/tags are ops' scope |
| 7 | error body `{ "error": { "code", "message" } }` | done — single error middleware for every endpoint |
| 8 | `GET /api/tags` → `{ "tags": [...] }` deduped, ascending | done — `SELECT DISTINCT name ... ORDER BY name` |
| 9 | PUT full replacement incl. tags; `title` required non-empty | done |
| 10 | CORS + `/api/health` | kept (harmless; healthcheck) |

Unchanged: endpoint set, Bookmark JSON (incl. `tags` string array), `q`+`tag`
AND filtering, ownership invariant (`user_id = JWT.sub`, others' resources → 404),
JWT HS256/7d Bearer, native parameterized `pg` SQL.

Answers to the 4 open questions are reflected as instructed: Node20/Express4/Postgres,
JWT, tags user-isolated (child rows), no pagination/soft-delete/grouping.

## Contract details

- Auth: `POST /api/auth/register` (username, email, password≥8) → `201 {token,user}`;
  `POST /api/auth/login` (email, password) → `200 {token,user}`; `GET /api/auth/me`.
- Bookmarks: `GET /api/bookmarks` (`q`, `tag`), `GET|PUT|DELETE /api/bookmarks/:id`,
  `POST /api/bookmarks`. `GET /api/tags`.
- Tag normalization: `trim` + lowercase + drop empty + dedup; ≤32 chars each;
  ≤20 per bookmark; stored ascending. `q` → `ILIKE '%q%'` over title/url/description;
  `tag` → `JOIN tags ... WHERE t.name=$n` with `DISTINCT`; both combine with AND.
- Error codes: `VALIDATION_ERROR`(400), `UNAUTHORIZED`(401),
  `INVALID_CREDENTIALS`(401), `NOT_FOUND`(404), `EMAIL_TAKEN`/`USERNAME_TAKEN`(409),
  `INTERNAL`(500).
- Ownership: every bookmark/tag query is scoped to `user_id = JWT.sub`; a foreign
  or missing id returns 404 (never 403).

## Environment

| Variable | Example | Note |
|---|---|---|
| `DATABASE_URL` | `postgres://linkmark:linkmark@db:5432/linkmark` | Compose-internal `db` host |
| `JWT_SECRET` | long random string | required; app refuses to start without it |
| `JWT_EXPIRES_IN` | `7d` | default `7d` |
| `PORT` | `3000` | default `3000` |

## Run / test

```
npm install
npm start          # needs a Postgres already initialized from db/init.sql
npm test           # pg-mem in-memory end-to-end suite (no external DB needed)
```

The test fixture DDL in `test/api.test.js` mirrors `db/init.sql` for in-memory
tests only; it is **not** executed by the running service.

## Ops notes

- Mount `db/init.sql` into the `db` container's `/docker-entrypoint-initdb.d/`.
  This is **required** because the backend does not create tables.
- Service name `backend`, port `3000`, image `postgres:16-alpine` per the contract.
- `/api/health` returns `200 {status:"ok"}` and can back the backend healthcheck.

## Verification & delivery

- `npm test` — pg-mem end-to-end suite, **17/17 pass** (auth, CRUD, `q`+`tag` AND,
  ownership 404, full tag replacement, cascade delete, unified error body, UUID ids,
  ISO-8601 timestamps).
- Full-chain preview — assembled with the architect's `db/init.sql`, this backend,
  and the built frontend `dist/` behind one same-origin port; all SPA / health /
  auth / CRUD / filter / ownership requests returned the expected statuses.
- This directory is the backend deliverable, also shipped as `backend.zip` task
  attachment. The repo has been restructured into the contract's §8 layout and
  synced to `main`; see the root `README.md` for the whole-project view.
