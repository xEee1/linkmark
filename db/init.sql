-- =============================================================
-- linkmark · PostgreSQL 初始化脚本（架构师维护，唯一权威 Schema）
-- 由运维挂载到 db 容器的 /docker-entrypoint-initdb.d/ 下，首次启动时执行。
-- 目标镜像：postgres:16-alpine（PG13+ 内置 gen_random_uuid()）
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(32) NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,               -- bcrypt(cost=10)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 书签表（每个书签归属一个用户）
CREATE TABLE IF NOT EXISTS bookmarks (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url         TEXT         NOT NULL,
    title       VARCHAR(255) NOT NULL,
    description TEXT         NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created
    ON bookmarks (user_id, created_at DESC);

-- 标签表（标签作为书签的子行，见 ARCHITECTURE.md「设计决策」）
CREATE TABLE IF NOT EXISTS tags (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    bookmark_id UUID        NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    name        VARCHAR(32) NOT NULL,
    UNIQUE (bookmark_id, name)
);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags (name);
