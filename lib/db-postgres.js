/**
 * 用户数据库 — PostgreSQL 后端（Vercel 生产环境用）
 *
 * 当设置了 DATABASE_URL 或 POSTGRES_URL 时自动启用。
 * 表结构在首次调用时自动创建。
 */
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL

let _pool = null
let _initDone = false

async function getPool() {
  if (!_pool) {
    const { Pool } = _require('pg')
    _pool = new Pool({
      connectionString: DB_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    })
  }
  if (!_initDone) {
    await initSchema()
    _initDone = true
  }
  return _pool
}

// ============================================================
// 建表
// ============================================================

async function initSchema() {
  const pool = _pool

  await pool.query(`
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
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id           SERIAL PRIMARY KEY,
      identifier   TEXT NOT NULL,
      success      INTEGER NOT NULL DEFAULT 0,
      ip           TEXT DEFAULT '',
      attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 索引
  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_wechat ON users(wechat_openid)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(identifier, attempted_at)')

  // 补列（兼容旧表——已有则跳过）
  for (const col of ['wechat_openid', 'source', 'must_change_password']) {
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} TEXT DEFAULT NULL`)
    } catch { /* 忽略已存在错误 */ }
  }
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password INTEGER DEFAULT 0")
  } catch { /* 忽略 */ }

  // 首次启动时创建超级管理员
  await seedAdmin()
}

async function seedAdmin() {
  const { rows } = await _pool.query('SELECT id FROM users WHERE username = $1', ['admin_zzq'])
  if (rows.length > 0) return

  const bcrypt = _require('bcryptjs')
  const hash = bcrypt.hashSync('Zzq@admin123', 12)
  await _pool.query(
    'INSERT INTO users (email, username, password_hash, role, credits) VALUES ($1, $2, $3, $4, $5)',
    ['admin_zzq@gaokao.local', 'admin_zzq', hash, 'admin', 999999]
  )
}

// ============================================================
// 安全查询字段（不含 password_hash）
// ============================================================
const USER_COLS = 'id, email, username, role, credits, credits_used, created_at, last_login, is_active, source, wechat_openid, must_change_password'

// ============================================================
// 用户查询
// ============================================================

export async function findUserByEmail(email) {
  const pool = await getPool()
  const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE email = $1`, [email])
  return rows[0] || null
}

export async function findUserByUsername(username) {
  const pool = await getPool()
  const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE username = $1`, [username])
  return rows[0] || null
}

export async function findUserByIdentifier(identifier) {
  const pool = await getPool()
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $1', [identifier])
  return rows[0] || null
}

export async function listAllUsers() {
  const pool = await getPool()
  const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users ORDER BY created_at DESC`)
  return rows
}

// ============================================================
// 微信用户
// ============================================================

export async function findUserByWechatOpenId(openId) {
  const pool = await getPool()
  const { rows } = await pool.query('SELECT * FROM users WHERE wechat_openid = $1', [openId])
  return rows[0] || null
}

export async function findOrCreateWechatUser(openId) {
  const existing = await findUserByWechatOpenId(openId)
  if (existing) return existing

  const username = 'wx_' + openId.slice(-8)
  const email = `wechat_${openId.slice(-8)}@wechat.gaokao.local`
  const pool = await getPool()

  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, username, password_hash, role, credits, source, wechat_openid) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [email, username, '', 'user', 10, 'wechat', openId]
    )
    return rows[0]
  } catch (err) {
    // 唯一约束冲突：换用户名重试
    const username2 = 'wx_' + openId.slice(-6) + String(Date.now()).slice(-4)
    const email2 = email.replace('@wechat', '_' + Date.now() % 10000 + '@wechat')
    const { rows } = await pool.query(
      'INSERT INTO users (email, username, password_hash, role, credits, source, wechat_openid) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [email2, username2, '', 'user', 10, 'wechat', openId]
    )
    return rows[0]
  }
}

// ============================================================
// 用户注册
// ============================================================

export async function createUser({ email, username, passwordHash }) {
  const pool = await getPool()
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, username, password_hash, must_change_password) VALUES ($1, $2, $3, 1) RETURNING id, email, username',
      [email, username, passwordHash]
    )
    return rows[0]
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      const msg = err.message || ''
      if (msg.includes('users_email') || msg.includes('email')) throw new Error('该邮箱已被注册')
      if (msg.includes('users_username') || msg.includes('username')) throw new Error('该用户名已被使用')
    }
    throw new Error('注册失败，请重试')
  }
}

// ============================================================
// 管理员操作
// ============================================================

export async function adminUpdateUser(userId, { role, credits, is_active }) {
  const sets = []
  const params = []
  let idx = 1
  if (role !== undefined) { sets.push(`role = $${idx++}`); params.push(role) }
  if (credits !== undefined) { sets.push(`credits = $${idx++}`); params.push(Number(credits)) }
  if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(is_active ? 1 : 0) }
  if (sets.length === 0) return false

  params.push(userId)
  const pool = await getPool()
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}`, params)
  return true
}

export async function adminDeleteUser(userId) {
  const pool = await getPool()
  await pool.query('DELETE FROM users WHERE id = $1 AND role != $2', [userId, 'admin'])
}

// ============================================================
// 修改密码
// ============================================================

export async function updatePassword(userId, newHash) {
  const pool = await getPool()
  await pool.query(
    'UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2',
    [newHash, userId]
  )
}

export async function getPasswordHash(userId) {
  const pool = await getPool()
  const { rows } = await pool.query(
    'SELECT password_hash, must_change_password FROM users WHERE id = $1',
    [userId]
  )
  return rows[0] || null
}

// ============================================================
// 积分系统
// ============================================================

export async function consumeCredit(userId) {
  const pool = await getPool()
  const { rows: users } = await pool.query(
    'SELECT credits, is_active FROM users WHERE id = $1',
    [userId]
  )
  const user = users[0]
  if (!user) return { ok: false, credits: 0, message: '用户不存在' }
  if (!user.is_active) return { ok: false, credits: 0, message: '账号已被禁用' }
  if (user.credits <= 0) return { ok: false, credits: 0, message: '积分不足，请联系管理员充值' }

  await pool.query(
    'UPDATE users SET credits = credits - 1, credits_used = credits_used + 1 WHERE id = $1',
    [userId]
  )
  const { rows: updated } = await pool.query('SELECT credits FROM users WHERE id = $1', [userId])
  return { ok: true, credits: updated[0]?.credits ?? 0 }
}

export async function getUserCredits(userId) {
  const pool = await getPool()
  const { rows } = await pool.query('SELECT credits, credits_used FROM users WHERE id = $1', [userId])
  return rows[0] || null
}

// ============================================================
// 登录记录
// ============================================================

export async function updateLastLogin(userId) {
  const pool = await getPool()
  await pool.query("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1", [userId])
}

export async function checkLoginRateLimit(identifier) {
  const pool = await getPool()
  const { rows } = await pool.query(`
    SELECT COUNT(*) as cnt FROM login_attempts
    WHERE identifier = $1 AND success = 0
      AND attempted_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'
  `, [identifier])
  return parseInt(rows[0]?.cnt || '0', 10) >= 5
}

export async function recordLoginAttempt({ identifier, success, ip = '' }) {
  const pool = await getPool()
  await pool.query(
    'INSERT INTO login_attempts (identifier, success, ip) VALUES ($1, $2, $3)',
    [identifier, success ? 1 : 0, ip]
  )
  await pool.query(
    "DELETE FROM login_attempts WHERE attempted_at < CURRENT_TIMESTAMP - INTERVAL '7 days'"
  )
}

// ============================================================
// 输入校验（纯函数，与 SQLite 版本一致）
// ============================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_RE = /^[a-zA-Z0-9_一-龥]{2,20}$/
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

export function validateEmail(email) {
  if (!email || typeof email !== 'string') return '请输入邮箱'
  email = email.trim().toLowerCase()
  if (email.length > 254) return '邮箱地址过长'
  if (!EMAIL_RE.test(email)) return '邮箱格式不正确'
  return null
}

export function validateUsername(username) {
  if (!username || typeof username !== 'string') return '请输入用户名'
  username = username.trim()
  if (username.length < 2 || username.length > 20) return '用户名长度应为 2-20 个字符'
  if (!USERNAME_RE.test(username)) return '用户名只能包含字母、数字、下划线和中文'
  return null
}

export function validatePassword(password) {
  if (!password || typeof password !== 'string') return '请输入密码'
  if (password.length < PASSWORD_MIN) return `密码长度不能少于 ${PASSWORD_MIN} 个字符`
  if (password.length > PASSWORD_MAX) return `密码长度不能超过 ${PASSWORD_MAX} 个字符`
  if (!/[a-zA-Z]/.test(password)) return '密码必须包含至少一个字母'
  if (!/[0-9]/.test(password)) return '密码必须包含至少一个数字'
  return null
}

export function sanitizeInput(str) {
  if (typeof str !== 'string') return ''
  return str.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

export async function closeDb() {
  if (_pool) { await _pool.end(); _pool = null }
}
