/**
 * 用户数据库 — SQLite 后端（本地开发用）
 * 使用 Node 内置 node:sqlite
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import bcrypt from 'bcryptjs'

const DB_PATH = join(process.cwd(), 'auth.db')

let _db = null

function getDb() {
  if (_db) return _db
  _db = new DatabaseSync(DB_PATH)
  _db.exec('PRAGMA journal_mode=WAL')
  _db.exec('PRAGMA foreign_keys=ON')
  initSchema()
  migrateSchema()
  seedAdmin()
  return _db
}

function initSchema() {
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      credits       INTEGER NOT NULL DEFAULT 10,
      credits_used  INTEGER NOT NULL DEFAULT 0,
      wechat_openid TEXT DEFAULT NULL,
      source        TEXT NOT NULL DEFAULT 'web',
      created_at    TEXT DEFAULT (datetime('now', 'localtime')),
      last_login    TEXT,
      is_active           INTEGER DEFAULT 1,
      must_change_password INTEGER DEFAULT 0
    )
  `)
  _db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)')
  _db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)')
  _db.exec('CREATE INDEX IF NOT EXISTS idx_users_wechat ON users(wechat_openid)')

  _db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier   TEXT NOT NULL,
      success      INTEGER NOT NULL DEFAULT 0,
      ip           TEXT DEFAULT '',
      attempted_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `)
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_login_attempts_id
    ON login_attempts(identifier, attempted_at)`)

  _db.exec(`
    CREATE TABLE IF NOT EXISTS ai_models (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      model_id    TEXT NOT NULL,
      provider    TEXT NOT NULL DEFAULT 'deepseek',
      api_key     TEXT NOT NULL DEFAULT '',
      api_url     TEXT NOT NULL DEFAULT 'https://api.deepseek.com/v1/chat/completions',
      enabled     INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      note        TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at  TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `)
}

/** 兼容旧表：补充缺少的列 */
function migrateSchema() {
  const existing = new Set(
    _db.prepare("PRAGMA table_info('users')").all().map(r => r.name)
  )
  const addCol = (col, def) => {
    if (!existing.has(col)) {
      _db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`)
    }
  }
  addCol('role', "TEXT NOT NULL DEFAULT 'user'")
  addCol('credits', 'INTEGER NOT NULL DEFAULT 10')
  addCol('credits_used', 'INTEGER NOT NULL DEFAULT 0')
  addCol('wechat_openid', 'TEXT DEFAULT NULL')
  addCol('source', "TEXT NOT NULL DEFAULT 'web'")
  addCol('must_change_password', 'INTEGER DEFAULT 0')
}

/** 首次启动时创建超级管理员 */
function seedAdmin() {
  const stmt = _db.prepare('SELECT id FROM users WHERE username = ?')
  const exists = stmt.get('admin_zzq')
  if (exists) return

  const hash = bcrypt.hashSync('Zzq@admin123', 12)
  _db.prepare(`
    INSERT INTO users (email, username, password_hash, role, credits)
    VALUES (?, ?, ?, 'admin', 999999)
  `).run('admin_zzq@gaokao.local', 'admin_zzq', hash)
}

// ============================================================
// 用户查询
// ============================================================

/** 安全查询字段（不含 password_hash） */
const USER_FIELDS = 'id, email, username, role, credits, credits_used, created_at, last_login, is_active, source, wechat_openid, must_change_password'

export function findUserByEmail(email) {
  const stmt = getDb().prepare(`SELECT ${USER_FIELDS} FROM users WHERE email = ?`)
  return stmt.get(email) || null
}

export function findUserByUsername(username) {
  const stmt = getDb().prepare(`SELECT ${USER_FIELDS} FROM users WHERE username = ?`)
  return stmt.get(username) || null
}

/** 登录用（含 password_hash） */
export function findUserByIdentifier(identifier) {
  const stmt = getDb().prepare('SELECT * FROM users WHERE email = ? OR username = ?')
  return stmt.get(identifier, identifier) || null
}

/** 管理后台：列出所有用户 */
export function listAllUsers() {
  const stmt = getDb().prepare(`SELECT ${USER_FIELDS} FROM users ORDER BY created_at DESC`)
  return stmt.all()
}

// ============================================================
// 微信用户
// ============================================================

/** 按 OpenID 查找用户 */
export function findUserByWechatOpenId(openId) {
  const stmt = getDb().prepare(`SELECT * FROM users WHERE wechat_openid = ?`)
  return stmt.get(openId) || null
}

/**
 * 创建或获取微信用户
 * 微信用户：无密码，通过 OpenID 自动识别，初始 10 积分
 */
export function findOrCreateWechatUser(openId) {
  const existing = findUserByWechatOpenId(openId)
  if (existing) return existing

  const username = 'wx_' + openId.slice(-8)
  const email = `wechat_${openId.slice(-8)}@wechat.gaokao.local`
  const stmt = getDb().prepare(`
    INSERT INTO users (email, username, password_hash, role, credits, source, wechat_openid)
    VALUES (?, ?, '', 'user', 10, 'wechat', ?)
  `)
  try {
    stmt.run(email, username, openId)
    return findUserByWechatOpenId(openId)
  } catch (err) {
    // 并发冲突：换一个用户名重试
    const username2 = 'wx_' + openId.slice(-6) + String(Date.now()).slice(-4)
    stmt.run(email.replace('@wechat', '_' + Date.now() % 10000 + '@wechat'), username2, openId)
    return findUserByWechatOpenId(openId)
  }
}

// ============================================================
// 用户注册
// ============================================================

export function createUser({ email, username, passwordHash }) {
  const stmt = getDb().prepare(
    'INSERT INTO users (email, username, password_hash, must_change_password) VALUES (?, ?, ?, 1)'
  )
  try {
    const result = stmt.run(email, username, passwordHash)
    return { id: Number(result.lastInsertRowid), email, username }
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      if (err.message?.includes('users.email')) throw new Error('该邮箱已被注册')
      if (err.message?.includes('users.username')) throw new Error('该用户名已被使用')
    }
    throw new Error('注册失败，请重试')
  }
}

// ============================================================
// 管理员操作
// ============================================================

/**
 * 更新用户信息（角色、积分、状态）
 */
export function adminUpdateUser(userId, { role, credits, is_active }) {
  const sets = []
  const params = []
  if (role !== undefined) { sets.push('role = ?'); params.push(role) }
  if (credits !== undefined) { sets.push('credits = ?'); params.push(Number(credits)) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (sets.length === 0) return false

  params.push(userId)
  getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return true
}

/** 删除用户 */
export function adminDeleteUser(userId) {
  getDb().prepare('DELETE FROM users WHERE id = ? AND role != ?').run(userId, 'admin')
}

// ============================================================
// 修改密码
// ============================================================

/** 更新密码并清除强制改密标记 */
export function updatePassword(userId, newHash) {
  getDb().prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?'
  ).run(newHash, userId)
}

/** 获取用户密码哈希（验证旧密码用） */
export function getPasswordHash(userId) {
  const row = getDb().prepare('SELECT password_hash, must_change_password FROM users WHERE id = ?').get(userId)
  return row || null
}

// ============================================================
// 积分系统
// ============================================================

/**
 * 消耗一次积分
 * @returns {{ ok: boolean, credits: number, message?: string }}
 */
export function consumeCredit(userId) {
  const user = getDb().prepare('SELECT credits, is_active FROM users WHERE id = ?').get(userId)
  if (!user) return { ok: false, credits: 0, message: '用户不存在' }
  if (!user.is_active) return { ok: false, credits: 0, message: '账号已被禁用' }
  if (user.credits <= 0) return { ok: false, credits: 0, message: '积分不足，请联系管理员充值' }

  getDb().prepare(
    'UPDATE users SET credits = credits - 1, credits_used = credits_used + 1 WHERE id = ?'
  ).run(userId)
  const updated = getDb().prepare('SELECT credits FROM users WHERE id = ?').get(userId)
  return { ok: true, credits: updated?.credits ?? 0 }
}

/** 查询用户积分 */
export function getUserCredits(userId) {
  const stmt = getDb().prepare('SELECT credits, credits_used FROM users WHERE id = ?')
  return stmt.get(userId) || null
}

// ============================================================
// 登录记录
// ============================================================

export function updateLastLogin(userId) {
  getDb().prepare(
    "UPDATE users SET last_login = datetime('now', 'localtime') WHERE id = ?"
  ).run(userId)
}

export function checkLoginRateLimit(identifier) {
  const row = getDb().prepare(`
    SELECT COUNT(*) as cnt FROM login_attempts
    WHERE identifier = ? AND success = 0
      AND attempted_at > datetime('now', '-10 minutes')
  `).get(identifier)
  return (row?.cnt || 0) >= 5
}

export function recordLoginAttempt({ identifier, success, ip = '' }) {
  getDb().prepare(
    'INSERT INTO login_attempts (identifier, success, ip) VALUES (?, ?, ?)'
  ).run(identifier, success ? 1 : 0, ip)
  getDb().prepare(
    "DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-7 days')"
  ).run()
}

// ============================================================
// 输入校验
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

export function closeDb() {
  if (_db) { _db.close(); _db = null }
}

// ============================================================
// AI 模型配置
// ============================================================

const MODEL_COLS = 'id, name, model_id, provider, api_key, api_url, enabled, sort_order, note, created_at, updated_at'

export function listModels() {
  return getDb().prepare(`SELECT ${MODEL_COLS} FROM ai_models ORDER BY sort_order ASC, id ASC`).all()
}

export function getEnabledModels() {
  return getDb().prepare(`SELECT ${MODEL_COLS} FROM ai_models WHERE enabled = 1 ORDER BY sort_order ASC, id ASC`).all()
}

export function getModel(id) {
  return getDb().prepare(`SELECT ${MODEL_COLS} FROM ai_models WHERE id = ?`).get(id) || null
}

export function createModel({ name, model_id, provider, api_key, api_url, note }) {
  const stmt = getDb().prepare(
    'INSERT INTO ai_models (name, model_id, provider, api_key, api_url, note) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const result = stmt.run(name, model_id, provider || 'deepseek', api_key || '', api_url || 'https://api.deepseek.com/v1/chat/completions', note || '')
  return { id: Number(result.lastInsertRowid) }
}

export function updateModel(id, fields) {
  const sets = []
  const params = []
  for (const key of ['name', 'model_id', 'provider', 'api_key', 'api_url', 'enabled', 'sort_order', 'note']) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`)
      params.push(fields[key])
    }
  }
  if (sets.length === 0) return false
  sets.push("updated_at = datetime('now', 'localtime')")
  params.push(id)
  getDb().prepare(`UPDATE ai_models SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return true
}

export function deleteModel(id) {
  getDb().prepare('DELETE FROM ai_models WHERE id = ?').run(id)
}
