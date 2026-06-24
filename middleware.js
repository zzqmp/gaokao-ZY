/**
 * 路由保护中间件
 * 使用 next-auth/jwt 直接验证 token，避免在 Edge Runtime 中引入数据库模块
 */
import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'

// 必须与 lib/auth.js 中的 secret 一致，否则 JWT 验证失败
const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'HX5KqqQ07/h0Ty5YCAI0p6IzEh6VO8yyjnkh64Bm81g='

// 无需登录即可访问的路径前缀
const PUBLIC_PATHS = ['/login', '/register', '/api/auth', '/api/debug']

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

  // 本地 HTTP 用非安全 cookie，Vercel HTTPS 用安全 cookie
  const isSecure = !!process.env.VERCEL || req.nextUrl.protocol === 'https:'
  const token = await getToken({ req, secret, secureCookie: isSecure })

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
