/**
 * 路由保护中间件
 * 使用 next-auth/jwt 直接验证 token，避免在 Edge Runtime 中引入数据库模块
 */
import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'

const secret = process.env.NEXTAUTH_SECRET || 'fallback-secret-do-not-use-in-prod'

// 无需登录即可访问的路径前缀
const PUBLIC_PATHS = ['/login', '/register', '/api/auth']

export async function middleware(req) {
  const { pathname } = req.nextUrl

  // 静态资源和公开路径直接放行
  if (
    pathname === '/favicon.ico' ||
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/_next/')
  ) {
    return NextResponse.next()
  }

  // 检查 JWT token（不访问数据库）
  const token = await getToken({ req, secret })

  if (!token) {
    const loginUrl = new URL('/login', req.nextUrl.origin)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return Response.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
