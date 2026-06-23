/**
 * 用户数据库 — 自动适配器
 *
 * 行为：
 *   - 设置了 DATABASE_URL 或 POSTGRES_URL → 使用 PostgreSQL（Vercel 生产）
 *   - 未设置                                      → 使用本地 SQLite（开发环境）
 *
 * 所有导出的函数签名与之前完全一致，调用方无需修改。
 * 表结构在首次调用时自动创建（两种后端均支持）。
 */
const USE_PG = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL)
const ON_VERCEL = !!process.env.VERCEL

let _mod = null
let _loadError = null

async function getMod() {
  if (_loadError) throw _loadError
  if (!_mod) {
    if (ON_VERCEL && !USE_PG) {
      _loadError = new Error(
        '⚠️ Vercel 环境需要设置 DATABASE_URL 环境变量（PostgreSQL 连接串）。' +
        '请到 Vercel 项目 → Settings → Environment Variables 添加。'
      )
      throw _loadError
    }
    try {
      _mod = await (USE_PG ? import('./db-postgres.js') : import('./db-sqlite.js'))
    } catch (e) {
      _loadError = new Error(
        '数据库模块加载失败: ' + e.message + '。' +
        (USE_PG
          ? '请检查 DATABASE_URL 是否正确，以及 pg 依赖是否已安装。'
          : '请检查 node:sqlite 是否可用（需要 Node.js 22+）。')
      )
      throw _loadError
    }
  }
  return _mod
}

// ============================================================
// 代理所有导出函数（懒加载对应后端模块）
// ============================================================

export async function findUserByEmail(email)               { return (await getMod()).findUserByEmail(email) }
export async function findUserByUsername(username)           { return (await getMod()).findUserByUsername(username) }
export async function findUserByIdentifier(identifier)      { return (await getMod()).findUserByIdentifier(identifier) }
export async function listAllUsers()                        { return (await getMod()).listAllUsers() }
export async function findUserByWechatOpenId(openId)        { return (await getMod()).findUserByWechatOpenId(openId) }
export async function findOrCreateWechatUser(openId)        { return (await getMod()).findOrCreateWechatUser(openId) }
export async function createUser(opts)                      { return (await getMod()).createUser(opts) }
export async function adminUpdateUser(userId, fields)       { return (await getMod()).adminUpdateUser(userId, fields) }
export async function adminDeleteUser(userId)               { return (await getMod()).adminDeleteUser(userId) }
export async function updatePassword(userId, newHash)       { return (await getMod()).updatePassword(userId, newHash) }
export async function getPasswordHash(userId)               { return (await getMod()).getPasswordHash(userId) }
export async function consumeCredit(userId)                 { return (await getMod()).consumeCredit(userId) }
export async function getUserCredits(userId)                { return (await getMod()).getUserCredits(userId) }
export async function updateLastLogin(userId)               { return (await getMod()).updateLastLogin(userId) }
export async function checkLoginRateLimit(identifier)       { return (await getMod()).checkLoginRateLimit(identifier) }
export async function recordLoginAttempt(opts)              { return (await getMod()).recordLoginAttempt(opts) }
export async function closeDb()                             { return (await getMod()).closeDb() }
export async function listModels()                          { return (await getMod()).listModels() }
export async function getEnabledModels()                    { return (await getMod()).getEnabledModels() }
export async function getModel(id)                          { return (await getMod()).getModel(id) }
export async function createModel(opts)                     { return (await getMod()).createModel(opts) }
export async function updateModel(id, fields)               { return (await getMod()).updateModel(id, fields) }
export async function deleteModel(id)                       { return (await getMod()).deleteModel(id) }

// 纯函数验证方法（直接导出，无需后端）
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
