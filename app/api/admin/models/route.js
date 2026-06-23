/**
 * 管理员 API - AI 模型配置管理
 * GET  /api/admin/models — 列出所有模型
 * POST /api/admin/models — 创建新模型
 */
import { requireAdmin } from '@/lib/admin-guard'
import { listModels, createModel } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const models = await listModels()
  return Response.json({ models })
}

export async function POST(request) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  try {
    const body = await request.json()
    if (!body.name || !body.model_id) {
      return Response.json({ error: '名称和模型 ID 不能为空' }, { status: 400 })
    }

    const result = await createModel({
      name: body.name.trim(),
      model_id: body.model_id.trim(),
      provider: body.provider || 'deepseek',
      api_key: body.api_key || '',
      api_url: body.api_url || 'https://api.deepseek.com/v1/chat/completions',
      note: body.note || '',
    })

    return Response.json({ ok: true, id: result.id }, { status: 201 })
  } catch (err) {
    console.error('创建模型失败:', err)
    return Response.json({ error: err.message || '创建失败' }, { status: 500 })
  }
}
