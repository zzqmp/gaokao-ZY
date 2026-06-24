/**
 * 用户注册 API
 * POST /api/auth/register
 * Body: { email, username }
 *
 * 流程：
 *   1. 校验 email + username
 *   2. 服务器生成随机密码
 *   3. 创建用户（bcrypt 哈希）
 *   4. 发送密码到注册邮箱
 *   5. 返回成功（邮箱中无密码时，开发模式返回密码摘要）
 */
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { sendRegistrationMail } from '@/lib/mail'
import {
  createUser,
  findUserByEmail,
  findUserByUsername,
  validateEmail,
  validateUsername,
  sanitizeInput,
} from '@/lib/db'

/** 生成安全随机密码（12 位，含大小写字母+数字+特殊字符） */
function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const special = '!@#$%'
  const all = upper + lower + digits + special

  // 确保至少包含各类型 1 位
  const parts = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    special[crypto.randomInt(special.length)],
  ]
  // 补齐到 12 位
  for (let i = parts.length; i < 12; i++) {
    parts.push(all[crypto.randomInt(all.length)])
  }
  // 打乱顺序
  for (let i = parts.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [parts[i], parts[j]] = [parts[j], parts[i]]
  }
  return parts.join('')
}

export async function POST(request) {
  try {
    const body = await request.json()
    const email = sanitizeInput(body.email || '').toLowerCase()
    const username = sanitizeInput(body.username || '')

    // === 服务端校验 ===
    const emailErr = validateEmail(email)
    if (emailErr) return Response.json({ error: emailErr }, { status: 400 })

    const usernameErr = validateUsername(username)
    if (usernameErr) return Response.json({ error: usernameErr }, { status: 400 })

    // === 查重 ===
    const existingEmail = await findUserByEmail(email)
    if (existingEmail) {
      return Response.json({ error: '该邮箱已被注册' }, { status: 409 })
    }

    const existingUser = await findUserByUsername(username)
    if (existingUser) {
      return Response.json({ error: '该用户名已被使用' }, { status: 409 })
    }

    // === 生成密码 + 创建用户 ===
    const password = generatePassword()
    const salt = await bcrypt.genSalt(12)
    const passwordHash = await bcrypt.hash(password, salt)

    const user = await createUser({ email, username, passwordHash })

    // === 发送邮件 ===
    let mailResult
    try {
      mailResult = await sendRegistrationMail({ to: email, username, password })
    } catch (mailErr) {
      console.error('[register] sendRegistrationMail failed:', mailErr.message)
      mailResult = { ok: false, message: '邮件发送异常: ' + mailErr.message }
    }

    return Response.json({
      ok: true,
      message: mailResult.ok
        ? '🎉 注册成功！密码已发送到您的邮箱'
        : `🎉 注册成功！密码：${password}（请尽快登录修改）`,
      user: { id: user.id, email: user.email, username: user.username },
      ...(mailResult.ok ? {} : { password }),
    })
  } catch (err) {
    if (err.message?.includes('已被注册') || err.message?.includes('已被使用')) {
      return Response.json({ error: err.message }, { status: 409 })
    }
    console.error('注册异常:', err.message, err.stack?.slice(0, 500))
    return Response.json({ error: '注册失败: ' + err.message }, { status: 500 })
  }
}
