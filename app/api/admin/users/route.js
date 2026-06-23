/**
 * 管理员 API - 用户列表
 * GET /api/admin/users — 获取所有用户
 */
import { requireAdmin } from '@/lib/admin-guard'
import { listAllUsers } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const users = await listAllUsers()
  return Response.json({ users, total: users.length })
}
