/**
 * 管理员 API - 单个用户管理
 * PATCH /api/admin/users/[id]   — 修改用户（角色/积分/状态）
 * DELETE /api/admin/users/[id]  — 删除用户
 */
import { requireAdmin } from '@/lib/admin-guard'
import { adminUpdateUser, adminDeleteUser } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const userId = Number(params.id)
  if (!userId || isNaN(userId)) {
    return Response.json({ error: '无效的用户 ID' }, { status: 400 })
  }

  try {
    const body = await request.json()

    // 校验参数
    const updates = {}
    if (body.role !== undefined) {
      if (!['admin', 'user'].includes(body.role)) {
        return Response.json({ error: '角色必须为 admin 或 user' }, { status: 400 })
      }
      updates.role = body.role
    }
    if (body.credits !== undefined) {
      const c = Number(body.credits)
      if (!Number.isInteger(c) || c < 0) {
        return Response.json({ error: '积分必须为非负整数' }, { status: 400 })
      }
      updates.credits = c
    }
    if (body.is_active !== undefined) {
      updates.is_active = !!body.is_active
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: '未提供要更新的字段' }, { status: 400 })
    }

    const ok = await adminUpdateUser(userId, updates)
    return Response.json({ ok, message: '更新成功' })
  } catch (err) {
    console.error('更新用户失败:', err)
    return Response.json({ error: '更新失败' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const userId = Number(params.id)
  if (!userId || isNaN(userId)) {
    return Response.json({ error: '无效的用户 ID' }, { status: 400 })
  }

  // 防止删除自己
  const adminId = Number(guard.session.user.id)
  if (userId === adminId) {
    return Response.json({ error: '不能删除自己的账号' }, { status: 400 })
  }

  await adminDeleteUser(userId)
  return Response.json({ ok: true, message: '用户已删除' })
}
