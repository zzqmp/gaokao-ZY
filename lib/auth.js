/**
 * Auth.js v5 配置 - 邮箱/用户名 + 密码登录（数据库认证）
 */
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import {
  findUserByIdentifier,
  updateLastLogin,
  checkLoginRateLimit,
  recordLoginAttempt,
  sanitizeInput,
} from '@/lib/db'

// Auth.js v5 在 Vercel 上需要 AUTH_SECRET 环境变量
// 否则 providers/session 端点会报 "server configuration" 错误
const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  trustHost: true,
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        identifier: { label: '邮箱/用户名', type: 'text' },
        password: { label: '密码', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) {
          throw new Error('请输入邮箱/用户名和密码')
        }

        const identifier = sanitizeInput(String(credentials.identifier).trim())
        const password = String(credentials.password)

        if (await checkLoginRateLimit(identifier)) {
          await recordLoginAttempt({ identifier, success: false })
          throw new Error('登录尝试过于频繁，请 10 分钟后再试')
        }

        const user = await findUserByIdentifier(identifier)
        if (!user) {
          await recordLoginAttempt({ identifier, success: false })
          throw new Error('邮箱/用户名或密码错误')
        }

        if (!user.is_active) {
          await recordLoginAttempt({ identifier, success: false })
          throw new Error('该账号已被禁用')
        }

        const valid = await bcrypt.compare(password, user.password_hash)
        if (!valid) {
          await recordLoginAttempt({ identifier, success: false })
          throw new Error('邮箱/用户名或密码错误')
        }

        await recordLoginAttempt({ identifier, success: true })
        await updateLastLogin(user.id)

        return {
          id: String(user.id),
          email: user.email,
          name: user.username,
          role: user.role,
          credits: user.credits,
          mustChangePassword: !!user.must_change_password,
        }
      },
    }),
  ],
  session: { strategy: 'jwt', maxAge: 24 * 60 * 60 },
  pages: { signIn: '/login' },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = user.role
        token.userId = user.id
        token.email = user.email
        token.credits = user.credits
        token.mustChangePassword = user.mustChangePassword
      }
      // 客户端调用 update() 时同步更新 JWT（修改密码后清除强制改密标记）
      if (trigger === 'update' && session?.mustChangePassword !== undefined) {
        token.mustChangePassword = session.mustChangePassword
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role
        session.user.id = token.userId
        session.user.email = token.email
        session.user.credits = token.credits
        session.user.mustChangePassword = token.mustChangePassword
      }
      return session
    },
  },
})
