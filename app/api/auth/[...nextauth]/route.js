/**
 * Auth.js 路由处理 — 带错误日志，用于排查 Vercel 上 providers 端点报错
 */
import { handlers } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    return await handlers.GET(request)
  } catch (e) {
    console.error('[auth GET] error:', e)
    return Response.json({ error: 'Auth handler failed', detail: e.message, stack: e.stack?.split('\n').slice(0,5) }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    return await handlers.POST(request)
  } catch (e) {
    console.error('[auth POST] error:', e)
    return Response.json({ error: 'Auth handler failed', detail: e.message }, { status: 500 })
  }
}
