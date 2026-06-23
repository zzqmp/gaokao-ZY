-- ============================================================
-- 高考志愿 AI 助手 — 用户认证表（PostgreSQL）
-- 在 Vercel 的 Postgres / Neon 数据库中执行此脚本初始化
-- ============================================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  email               TEXT UNIQUE NOT NULL,
  username            TEXT UNIQUE NOT NULL,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'user',
  credits             INTEGER NOT NULL DEFAULT 10,
  credits_used        INTEGER NOT NULL DEFAULT 0,
  wechat_openid       TEXT DEFAULT NULL,
  source              TEXT NOT NULL DEFAULT 'web',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login          TIMESTAMP,
  is_active           INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_wechat ON users(wechat_openid);

-- 登录尝试记录（限流用）
CREATE TABLE IF NOT EXISTS login_attempts (
  id           SERIAL PRIMARY KEY,
  identifier   TEXT NOT NULL,
  success      INTEGER NOT NULL DEFAULT 0,
  ip           TEXT DEFAULT '',
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(identifier, attempted_at);
