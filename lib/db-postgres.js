/**
 * 用户数据库 — PostgreSQL 后端（Vercel 生产环境用）
 *
 * 当设置了 DATABASE_URL 或 POSTGRES_URL 时自动启用。
 * 表结构在首次调用时自动创建。
 *
 * 注意：用标准 ESM import（不用 createRequire），否则 Next.js 打包后路径会失效。
 */
import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL

let _pool = null
let _initDone = false

async function getPool() {
  if (!_pool) {
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

  // AI 模型配置表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_models (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      model_id    TEXT NOT NULL,
      provider    TEXT NOT NULL DEFAULT 'deepseek',
      api_key     TEXT NOT NULL DEFAULT '',
      api_url     TEXT NOT NULL DEFAULT 'https://api.deepseek.com/v1/chat/completions',
      enabled     INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      note        TEXT DEFAULT '',
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 微信待发送回复表（AI 分析结果暂存，应对 5 秒超时）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wechat_pending_replies (
      id          SERIAL PRIMARY KEY,
      msg_id      TEXT NOT NULL UNIQUE,
      open_id     TEXT NOT NULL,
      query_text  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      reply_text  TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pending_openid ON wechat_pending_replies(open_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pending_msgid ON wechat_pending_replies(msg_id)')

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

// ============================================================
// AI 模型配置
// ============================================================

const MODEL_COLS = 'id, name, model_id, provider, api_key, api_url, enabled, sort_order, note, created_at, updated_at'

export async function listModels() {
  const pool = await getPool()
  const { rows } = await pool.query(`SELECT ${MODEL_COLS} FROM ai_models ORDER BY sort_order ASC, id ASC`)
  return rows
}

export async function getEnabledModels() {
  const pool = await getPool()
  const { rows } = await pool.query(
    `SELECT ${MODEL_COLS} FROM ai_models WHERE enabled = 1 ORDER BY sort_order ASC, id ASC`
  )
  return rows
}

export async function getModel(id) {
  const pool = await getPool()
  const { rows } = await pool.query(`SELECT ${MODEL_COLS} FROM ai_models WHERE id = $1`, [id])
  return rows[0] || null
}

export async function createModel({ name, model_id, provider, api_key, api_url, note }) {
  const pool = await getPool()
  const { rows } = await pool.query(
    `INSERT INTO ai_models (name, model_id, provider, api_key, api_url, note)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name, model_id, provider || 'deepseek', api_key || '', api_url || 'https://api.deepseek.com/v1/chat/completions', note || '']
  )
  return rows[0]
}

export async function updateModel(id, fields) {
  const sets = []
  const params = []
  let idx = 1
  for (const key of ['name', 'model_id', 'provider', 'api_key', 'api_url', 'enabled', 'sort_order', 'note']) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`)
      params.push(fields[key])
    }
  }
  if (sets.length === 0) return false
  sets.push(`updated_at = CURRENT_TIMESTAMP`)
  params.push(id)
  const pool = await getPool()
  await pool.query(`UPDATE ai_models SET ${sets.join(', ')} WHERE id = $${idx}`, params)
  return true
}

export async function deleteModel(id) {
  const pool = await getPool()
  await pool.query('DELETE FROM ai_models WHERE id = $1', [id])
}

// ============================================================
// 微信待发送回复（AI 分析结果暂存，应对 5 秒超时）
// ============================================================

export async function savePendingReply(msgId, openId, queryText) {
  const pool = await getPool()
  await pool.query(`
    INSERT INTO wechat_pending_replies (msg_id, open_id, query_text, status)
    VALUES ($1, $2, $3, 'pending')
    ON CONFLICT (msg_id) DO UPDATE SET status = 'pending', updated_at = CURRENT_TIMESTAMP
  `, [msgId, openId, queryText])
}

export async function updatePendingReply(msgId, replyText) {
  const pool = await getPool()
  await pool.query(`
    UPDATE wechat_pending_replies SET status = 'done', reply_text = $1, updated_at = CURRENT_TIMESTAMP
    WHERE msg_id = $2
  `, [replyText, msgId])
}

/** 获取用户最近一条未送达的待发送回复 */
export async function getUserPendingReply(openId) {
  const pool = await getPool()
  const { rows } = await pool.query(`
    SELECT * FROM wechat_pending_replies
    WHERE open_id = $1 AND status = 'done'
    ORDER BY created_at DESC LIMIT 1
  `, [openId])
  return rows[0] || null
}

/** 按 msg_id 获取 pending 记录（用于微信重试路径） */
export async function getPendingReplyByMsgId(msgId) {
  const pool = await getPool()
  const { rows } = await pool.query(
    'SELECT * FROM wechat_pending_replies WHERE msg_id = $1', [msgId]
  )
  return rows[0] || null
}

export async function deletePendingReply(msgId) {
  const pool = await getPool()
  await pool.query('DELETE FROM wechat_pending_replies WHERE msg_id = $1', [msgId])
}

/** 清理超过 24 小时的过期记录 */
export async function cleanExpiredPendingReplies() {
  const pool = await getPool()
  await pool.query(
    "DELETE FROM wechat_pending_replies WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'"
  )
}
