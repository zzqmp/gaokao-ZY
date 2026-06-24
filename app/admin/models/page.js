'use client'

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function AdminModelsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // 新增/编辑弹窗
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())

  function emptyForm() {
    return {
      name: '',
      model_id: '',
      provider: 'deepseek',
      api_key: '',
      api_url: 'https://api.deepseek.com/v1/chat/completions',
      enabled: 0,
      note: '',
    }
  }

  // 权限检查
  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return }
    if (status === 'authenticated' && session?.user?.role !== 'admin') {
      router.push('/')
    }
  }, [status, session, router])

  // 加载模型列表
  useEffect(() => {
    if (status !== 'authenticated' || session?.user?.role !== 'admin') return
    fetchModels()
  }, [status, session])

  async function fetchModels() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/models')
      if (!res.ok) throw new Error('加载失败')
      const data = await res.json()
      setModels(data.models || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  function openEdit(m) {
    setEditingId(m.id)
    setForm({
      name: m.name,
      model_id: m.model_id,
      provider: m.provider,
      api_key: m.api_key,
      api_url: m.api_url,
      enabled: m.enabled,
      note: m.note || '',
    })
    setShowForm(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    setMessage('')
    try {
      if (editingId) {
        const res = await fetch(`/api/admin/models/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '更新失败')
        setMessage('✅ 模型已更新')
      } else {
        const res = await fetch('/api/admin/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '创建失败')
        setMessage('✅ 模型已创建')
      }
      setShowForm(false)
      fetchModels()
    } catch (e) {
      setMessage(`❌ ${e.message}`)
    }
  }

  async function handleToggle(model, enabled) {
    setMessage('')
    try {
      const res = await fetch(`/api/admin/models/${model.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled ? 1 : 0 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '操作失败')
      setMessage(enabled ? '✅ 模型已启用' : '⏸️ 模型已禁用')
      fetchModels()
    } catch (e) {
      setMessage(`❌ ${e.message}`)
    }
  }

  async function handleDelete(model) {
    if (!confirm(`确定要删除模型「${model.name}」吗？`)) return
    setMessage('')
    try {
      const res = await fetch(`/api/admin/models/${model.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '删除失败')
      setMessage(`✅ 模型「${model.name}」已删除`)
      fetchModels()
    } catch (e) {
      setMessage(`❌ ${e.message}`)
    }
  }

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">加载中...</div>
  }
  if (session?.user?.role !== 'admin') return null

  const enabledCount = models.filter(m => m.enabled).length

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶栏 */}
      <header className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold">⚙️ 管理后台</h1>
            <nav className="flex gap-3 text-sm">
              <Link href="/admin/users" className="text-slate-300 hover:text-white">用户管理</Link>
              <span className="text-white font-medium border-b-2 border-white">模型配置</span>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-300">{session.user.name}</span>
            <button onClick={() => router.push('/')} className="text-xs px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-md">
              返回首页
            </button>
            <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-xs px-3 py-1.5 bg-red-500/30 hover:bg-red-500/50 rounded-md">
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* 消息 */}
        {message && (
          <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm flex justify-between items-center">
            <span>{message}</span>
            <button onClick={() => setMessage('')} className="text-blue-400 hover:text-blue-600">✕</button>
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        {/* 快捷操作 */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-slate-500">
            共 <strong>{models.length}</strong> 个模型，<strong className="text-green-600">{enabledCount}</strong> 个已启用
          </div>
          <button onClick={openCreate}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
            + 添加模型
          </button>
        </div>

        {/* 模型列表 */}
        {loading ? (
          <div className="text-center py-12 text-slate-400">加载中...</div>
        ) : models.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <div className="text-4xl mb-3">🤖</div>
            <div className="text-slate-500 mb-4">还没有配置任何 AI 模型</div>
            <button onClick={openCreate}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
              添加第一个模型
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {models.map(m => (
              <div key={m.id} className={`bg-white rounded-lg border p-4 ${
                m.enabled ? 'border-green-300 shadow-sm' : 'border-slate-200'
              }`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{m.provider === 'openai' ? '🤖' : '🔮'}</span>
                      <span className="font-medium text-slate-900">{m.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">{m.model_id}</span>
                      {m.enabled ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 font-medium">已启用</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-400 font-medium">已禁用</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 space-x-3">
                      <span>供应商: {m.provider}</span>
                      {m.note && <span>📌 {m.note}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {/* 开关 */}
                    <button
                      onClick={() => handleToggle(m, !m.enabled)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        m.enabled ? 'bg-green-500' : 'bg-slate-300'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        m.enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`} />
                    </button>
                    <button onClick={() => openEdit(m)}
                      className="text-xs px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md">编辑</button>
                    <button onClick={() => handleDelete(m)}
                      className="text-xs px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-md">删除</button>
                  </div>
                </div>

                {/* 展开详情（编辑模式） */}
                {editingId === m.id && showForm && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <FormContent form={form} setForm={setForm} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 新增/编辑弹窗 */}
        {showForm && !editingId && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setShowForm(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-slate-900 mb-4">添加新模型</h2>
              <form onSubmit={handleSave} className="space-y-4">
                <FormContent form={form} setForm={setForm} />
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
                    保存
                  </button>
                  <button type="button" onClick={() => setShowForm(false)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm">
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  )

}

/** 支持 IME 中文输入的输入框 */
function SmartInput({ onChange, ...rest }) {
  const [composing, setComposing] = useState(false)
  return (
    <input
      {...rest}
      onChange={e => { if (!composing && onChange) onChange(e) }}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={e => { setComposing(false); if (onChange) onChange(e) }}
    />
  )
}

/** 表单内容 */
function FormContent({ form, setForm }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">名称 *</label>
          <SmartInput type="text" required value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="例如: DeepSeek V3"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">模型 ID *</label>
          <SmartInput type="text" required value={form.model_id}
            onChange={e => setForm({ ...form, model_id: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="例如: deepseek-chat"/>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">供应商</label>
          <select value={form.provider}
            onChange={e => setForm({ ...form, provider: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">API 密钥</label>
          <SmartInput type="text" value={form.api_key}
            onChange={e => setForm({ ...form, api_key: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
            placeholder="留空则使用环境变量"/>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">API 地址</label>
        <SmartInput type="text" value={form.api_url}
          onChange={e => setForm({ ...form, api_url: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
          placeholder="https://api.deepseek.com/v1/chat/completions"/>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">备注</label>
        <SmartInput type="text" value={form.note}
          onChange={e => setForm({ ...form, note: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          placeholder="例如: 测试模型，仅用于验证"/>
      </div>
    </>
  )
}
