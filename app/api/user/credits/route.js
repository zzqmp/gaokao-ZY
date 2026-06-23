/**
 * 获取当前用户积分
 * GET /api/user/credits
 */
import { auth } from '@/lib/auth'
import { getUserCredits } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录' }, { status: 401 })
  }

  const data = await getUserCredits(session.user.id)
  return Response.json({
    credits: data?.credits ?? 0,
    credits_used: data?.credits_used ?? 0,
  })
}
