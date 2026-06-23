'use client'

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function AdminUsersPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editCredits, setEditCredits] = useState('')
  const [message, setMessage] = useState('')
  const [stats, setStats] = useState({})

  // 检查管理员权限
  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return }
    if (status === 'authenticated' && session?.user?.role !== 'admin') {
      router.push('/')
    }
  }, [status, session, router])

  // 加载用户列表
  useEffect(() => {
    if (status !== 'authenticated' || session?.user?.role !== 'admin') return
    fetchUsers()
  }, [status, session])

  async function fetchUsers() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/users')
      if (!res.ok) throw new Error('加载失败')
      const data = await res.json()
      setUsers(data.users || [])
      setStats({
        total: data.total,
        admin: data.users.filter(u => u.role === 'admin').length,
        active: data.users.filter(u => u.is_active).length,
        totalCredits: data.users.reduce((s, u) => s + u.credits, 0),
        totalUsed: data.users.reduce((s, u) => s + u.credits_used, 0),
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate(userId, updates) {
    setMessage('')
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '更新失败')
      setMessage('✅ 更新成功')
      fetchUsers()
      setEditingId(null)
    } catch (e) {
      setMessage(`❌ ${e.message}`)
    }
  }

  async function handleDelete(user) {
    if (!confirm(`确定要删除用户「${user.username}」吗？此操作不可撤销。`)) return
    setMessage('')
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '删除失败')
      setMessage(`✅ 用户「${user.username}」已删除`)
      fetchUsers()
    } catch (e) {
      setMessage(`❌ ${e.message}`)
    }
  }

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">加载中...</div>
  }
  if (session?.user?.role !== 'admin') return null

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶栏 */}
      <header className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold">⚙️ 管理后台</h1>
            <nav className="flex gap-3 text-sm">
              <span className="text-white font-medium border-b-2 border-white">用户管理</span>
              <Link href="/admin/models" className="text-slate-300 hover:text-white">模型配置</Link>
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
        {/* 概览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {[
            { label: '总用户', value: stats.total, color: 'text-blue-600' },
            { label: '管理员', value: stats.admin, color: 'text-purple-600' },
            { label: '活跃用户', value: stats.active, color: 'text-green-600' },
            { label: '剩余积分', value: stats.totalCredits, color: 'text-amber-600' },
            { label: '已消耗积分', value: stats.totalUsed, color: 'text-red-600' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="text-xs text-slate-500 mb-1">{s.label}</div>
              <div className={`text-2xl font-bold ${s.color}`}>{s.value ?? '-'}</div>
            </div>
          ))}
        </div>

        {/* 消息提示 */}
        {message && (
          <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm">
            {message}
            <button onClick={() => setMessage('')} className="ml-3 text-blue-400 hover:text-blue-600">✕</button>
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* 用户表格 */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">ID</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">用户名</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">邮箱</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">角色</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">状态</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">积分</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">已用</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">注册时间</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">最后登录</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="text-center py-8 text-slate-400">加载中...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-8 text-slate-400">暂无用户</td></tr>
                ) : users.map(u => (
                  <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{u.id}</td>
                    <td className="px-4 py-3 font-medium">
                      {u.username}
                      {u.username === 'admin_zzq' && <span className="ml-1.5 text-xs text-purple-500">★</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                      }`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>{u.is_active ? '启用' : '禁用'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {editingId === u.id ? (
                        <div className="flex gap-1">
                          <input
                            type="number"
                            value={editCredits}
                            onChange={e => setEditCredits(e.target.value)}
                            className="w-20 px-2 py-1 border border-slate-300 rounded text-xs"
                            min={0}
                          />
                          <button onClick={() => handleUpdate(u.id, { credits: parseInt(editCredits) })}
                            className="text-green-600 hover:text-green-800 text-xs font-medium">保存</button>
                          <button onClick={() => setEditingId(null)}
                            className="text-slate-400 hover:text-slate-600 text-xs">取消</button>
                        </div>
                      ) : (
                        <span className="font-medium">{u.credits}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.credits_used}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{u.created_at}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{u.last_login || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingId(u.id); setEditCredits(String(u.credits)) }}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium">积分</button>
                        <button onClick={() => handleUpdate(u.id, { is_active: !u.is_active })}
                          className={`text-xs font-medium ${u.is_active ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800'}`}>
                          {u.is_active ? '禁用' : '启用'}
                        </button>
                        {u.role !== 'admin' && (
                          <button onClick={() => handleDelete(u)}
                            className="text-red-600 hover:text-red-800 text-xs font-medium">删除</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 text-xs text-slate-400">
          <p>💡 提示：管理员不可删除。点击「积分」可修改用户剩余积分。禁用后用户无法登录和使用。</p>
        </div>
      </main>
    </div>
  )
}
