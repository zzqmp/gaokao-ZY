/**
 * 服务器诊断 API — 检查模块加载、数据库连接、环境变量
 * GET /api/debug
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const info = {
    node: process.version,
    platform: process.platform,
    vercel: !!process.env.VERCEL,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? '✅ 已设置' : '❌ 未设置',
      POSTGRES_URL: process.env.POSTGRES_URL ? '✅ 已设置' : '❌ 未设置',
      AUTH_SECRET: process.env.AUTH_SECRET ? '✅ 已设置' : '❌ 未设置',
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? '✅ 已设置' : '❌ 未设置',
      VERCEL_ENV: process.env.VERCEL_ENV || 'local',
      NODE_ENV: process.env.NODE_ENV,
    },
    modules: {},
    db: null,
  }

  // 1. 测试模块加载
  try {
    const pgMod = await import('pg')
    info.modules.pg = '✅ 加载成功 (v' + (pgMod?.Pool?.name || '?') + ')'
  } catch (e) {
    info.modules.pg = '❌ 加载失败: ' + e.message
  }

  try {
    const bcryptMod = await import('bcryptjs')
    info.modules.bcryptjs = '✅ 加载成功'
    // 测试是否可调用
    try {
      const hash = bcryptMod.hashSync('test', 4)
      const match = bcryptMod.compareSync('test', hash)
      info.modules.bcryptjs += ' | 哈希/对比: ' + (match ? '✅' : '❌')
    } catch (e2) {
      info.modules.bcryptjs += ' | 函数调用: ❌ ' + e2.message
    }
  } catch (e) {
    info.modules.bcryptjs = '❌ 加载失败: ' + e.message
  }

  // 2. 测试 db 模块加载
  try {
    const dbMod = await import('@/lib/db')
    info.modules.db = '✅ 加载成功'

    // 尝试连接数据库（只 check，不修改数据）
    try {
      await dbMod.findUserByEmail('debug-test@test.local')
      info.db = '✅ 查询成功（连接正常）'
    } catch (eDb) {
      info.db = '❌ 查询失败: ' + eDb.message
    }
  } catch (e) {
    info.modules.db = '❌ 加载失败: ' + e.message
  }

  // 3. 测试 auth 模块加载
  try {
    const authMod = await import('@/lib/auth')
    info.modules.auth = '✅ 加载成功'
  } catch (e) {
    info.modules.auth = '❌ 加载失败: ' + e.message
  }

  return Response.json(info)
}
