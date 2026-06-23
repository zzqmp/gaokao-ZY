/**
 * 管理员 API - 单模型管理
 * PATCH  /api/admin/models/[id] — 更新模型配置
 * DELETE /api/admin/models/[id] — 删除模型
 */
import { requireAdmin } from '@/lib/admin-guard'
import { updateModel, deleteModel, getModel } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const modelId = Number(params.id)
  if (!modelId || isNaN(modelId)) {
    return Response.json({ error: '无效的模型 ID' }, { status: 400 })
  }

  try {
    const body = await request.json()

    // 校验
    const updates = {}
    for (const key of ['name', 'model_id', 'provider', 'api_key', 'api_url', 'enabled', 'sort_order', 'note']) {
      if (body[key] !== undefined) {
        if (key === 'enabled') {
          updates[key] = body[key] ? 1 : 0
        } else if (key === 'sort_order') {
          updates[key] = Number(body[key]) || 0
        } else {
          updates[key] = String(body[key]).trim()
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: '未提供要更新的字段' }, { status: 400 })
    }

    const ok = await updateModel(modelId, updates)
    return Response.json({ ok, message: '更新成功' })
  } catch (err) {
    console.error('更新模型失败:', err)
    return Response.json({ error: '更新失败' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const modelId = Number(params.id)
  if (!modelId || isNaN(modelId)) {
    return Response.json({ error: '无效的模型 ID' }, { status: 400 })
  }

  await deleteModel(modelId)
  return Response.json({ ok: true, message: '模型已删除' })
}
