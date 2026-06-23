/**
 * 管理员权限守卫
 * 在 API 路由中调用，校验当前 session 是否为 admin
 */
import { auth } from '@/lib/auth'

export async function requireAdmin() {
  const session = await auth()
  if (!session?.user) {
    return { ok: false, response: Response.json({ error: '未登录' }, { status: 401 }) }
  }
  if (session.user.role !== 'admin') {
    return { ok: false, response: Response.json({ error: '权限不足' }, { status: 403 }) }
  }
  return { ok: true, session, response: null }
}
