/**
 * 修改密码 API
 * POST /api/auth/change-password
 * Body: { currentPassword, newPassword }
 */
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { getPasswordHash, updatePassword, validatePassword } from '@/lib/db'

export async function POST(request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ error: '未登录' }, { status: 401 })
    }

    const { currentPassword, newPassword } = await request.json()

    if (!currentPassword || !newPassword) {
      return Response.json({ error: '请填写当前密码和新密码' }, { status: 400 })
    }

    // 校验新密码强度
    const passErr = validatePassword(newPassword)
    if (passErr) {
      return Response.json({ error: passErr }, { status: 400 })
    }

    if (currentPassword === newPassword) {
      return Response.json({ error: '新密码不能与当前密码相同' }, { status: 400 })
    }

    // 验证旧密码
    const user = await getPasswordHash(session.user.id)
    if (!user) {
      return Response.json({ error: '用户不存在' }, { status: 404 })
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash)
    if (!valid) {
      return Response.json({ error: '当前密码错误' }, { status: 403 })
    }

    // 更新密码并清除强制改密标记
    const salt = await bcrypt.genSalt(12)
    const newHash = await bcrypt.hash(newPassword, salt)
    await updatePassword(session.user.id, newHash)

    return Response.json({
      ok: true,
      message: '密码修改成功',
      mustChangePassword: false,
    })
  } catch (err) {
    console.error('修改密码失败:', err)
    return Response.json({ error: '修改密码失败，请重试' }, { status: 500 })
  }
}
