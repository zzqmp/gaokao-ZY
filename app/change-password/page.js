'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function ChangePasswordPage() {
  const { data: session, update: updateSession, status } = useSession()
  const router = useRouter()
  const isForced = session?.user?.mustChangePassword

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (form.newPassword !== form.confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    if (form.newPassword.length < 8) {
      setError('新密码长度不能少于 8 个字符')
      return
    }
    if (!/[a-zA-Z]/.test(form.newPassword)) {
      setError('新密码必须包含至少一个字母')
      return
    }
    if (!/[0-9]/.test(form.newPassword)) {
      setError('新密码必须包含至少一个数字')
      return
    }
    if (form.currentPassword === form.newPassword) {
      setError('新密码不能与当前密码相同')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '修改失败')
        return
      }
      setSuccess(true)
      // 通过 NextAuth 的 update() 同步更新 JWT 中的 mustChangePassword 字段
      await updateSession({ mustChangePassword: false })
      window.location.href = '/'
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">加载中...</div>
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
        <div className="w-full max-w-sm bg-white rounded-xl shadow-lg border border-slate-200 p-8 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">密码修改成功</h1>
          <p className="text-sm text-slate-500 mb-6">正在跳转...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-8">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🔐</div>
            <h1 className="text-xl font-bold text-slate-900">
              {isForced ? '首次登录 · 设置新密码' : '修改密码'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {isForced
                ? '首次登录请设置新密码后继续使用'
                : '输入当前密码和新密码'}
            </p>
          </div>

          {isForced && (
            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              ⚠️ 首次登录需要修改密码才能继续使用
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">当前密码</label>
              <input
                type="password"
                value={form.currentPassword}
                onChange={e => updateField('currentPassword', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="输入当前密码"
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">新密码</label>
              <input
                type="password"
                value={form.newPassword}
                onChange={e => updateField('newPassword', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="至少 8 位，含字母和数字"
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">确认新密码</label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={e => updateField('confirmPassword', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="再次输入新密码"
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium text-sm transition-colors"
            >
              {loading ? '修改中...' : (isForced ? '设置密码并继续' : '修改密码')}
            </button>
          </form>

          {!isForced && (
            <div className="mt-6 text-center">
              <button
                onClick={() => router.push('/')}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                ← 返回首页
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
